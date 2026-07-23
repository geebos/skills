#!/usr/bin/env python3
"""校验追加-only 技术文档评审的结构不变量。"""

from __future__ import annotations

import argparse
from datetime import datetime
import re
import subprocess
import sys
from pathlib import Path


ROUND_HEADING = re.compile(r"^## Round (\d+)\s*$", re.MULTILINE)
NEW_ISSUE = re.compile(r"^#### (R\d{3,})：[^\n]+$", re.MULTILINE)
STATUS_EVENT = re.compile(r"^\* (R\d{3,})：([^\n]+)$", re.MULTILINE)
ANSWER_HEADING = re.compile(r"^##### Answer\s*$", re.MULTILINE)
REVIEW_HEADING = re.compile(r"^##### Review\s*$", re.MULTILINE)
PLACEHOLDER = re.compile(
    r"<(?:document-name|full-hash|YYYY-MM-DD|count|hash|问题标题|确定性结论)"
)
FUZZY_TERMS = (
    "可以",
    "建议",
    "推荐",
    "尽量",
    "原则上",
    "视情况而定",
    "按需处理",
    "根据实际情况决定",
    "必要时",
    "合理设置",
    "适当调整",
    "后续确定",
)
REQUIRED_ROUND_SECTIONS = (
    "新增问题",
    "本轮技术结论",
    "状态变更",
    "未关闭问题",
)
COMPLETION_COUNT = re.compile(
    r"^\* (Review 轮次|已审阅技术点|已确定技术结论|已关闭问题|未决技术点)：(\d+)\s*$",
    re.MULTILINE,
)
ISSUE_BLOCK = re.compile(
    r"^#### (R\d{3,})：[^\n]*\n(.*?)(?=^#### R\d{3,}：|^### |\Z)",
    re.MULTILINE | re.DOTALL,
)


def git_output(*args: str) -> str | None:
    result = subprocess.run(
        ["git", *args],
        check=False,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip() if result.returncode == 0 else None


def round_blocks(text: str) -> list[tuple[int, str]]:
    matches = list(ROUND_HEADING.finditer(text))
    blocks: list[tuple[int, str]] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        completed = text.find("\n## Review 完成", match.end(), end)
        if completed != -1:
            end = completed
        blocks.append((int(match.group(1)), text[match.start() : end]))
    return blocks


def issue_event_coverage(text: str) -> tuple[set[str], set[str], set[str]]:
    """Return (defined_ids, ids_with_answer, ids_with_review)."""
    defined: list[str] = []
    with_answer: set[str] = set()
    with_review: set[str] = set()
    for match in ISSUE_BLOCK.finditer(text):
        issue_id = match.group(1)
        body = match.group(2)
        defined.append(issue_id)
        if ANSWER_HEADING.search(body):
            with_answer.add(issue_id)
        if REVIEW_HEADING.search(body):
            with_review.add(issue_id)
    return set(defined), with_answer, with_review


def validate(document: Path, review: Path, mode: str) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    if not document.is_file():
        errors.append(f"技术文档不存在：{document}")
    if not review.is_file():
        errors.append(f"评审文档不存在：{review}")
        return errors, warnings

    expected_name = f"review-{document.name}"
    if review.name != expected_name:
        errors.append(f"评审文档文件名必须为 {expected_name}")

    review_text = review.read_text(encoding="utf-8")
    document_text = document.read_text(encoding="utf-8") if document.is_file() else ""

    if not re.search(r"^## 基本信息\s*$", review_text, re.MULTILINE):
        errors.append("缺少「## 基本信息」章节")
    else:
        if "technical_doc_reviewer" not in review_text.split("## Round", 1)[0]:
            errors.append("基本信息必须标识 technical_doc_reviewer")
        if "technical_doc_answerer" not in review_text.split("## Round", 1)[0]:
            errors.append("基本信息必须标识 technical_doc_answerer")

    blocks = round_blocks(review_text)
    numbers = [number for number, _ in blocks]
    if not blocks:
        errors.append("未找到 Round 章节")
    elif numbers != list(range(1, len(numbers) + 1)):
        errors.append(f"评审轮次必须从 1 连续递增；实际为 {numbers}")

    for number, block in blocks:
        for section in REQUIRED_ROUND_SECTIONS:
            count = len(re.findall(rf"^### {re.escape(section)}\s*$", block, re.MULTILINE))
            if count != 1:
                errors.append(
                    f"Round {number} 必须恰好包含一个「{section}」小节；实际为 {count}"
                )
        if "完成 Commit：当前记录所在 Commit" not in block:
            errors.append(
                f"Round {number} 的自引用 commit 必须使用「当前记录所在 Commit」"
            )
        for label in ("起始 Commit", "技术文档 Commit"):
            if not re.search(
                rf"^\* {re.escape(label)}：`?[0-9a-f]{{7,40}}`?\s*$",
                block,
                re.MULTILINE,
            ):
                errors.append(f"Round {number} 必须为 {label} 记录 Git hash")

    issue_ids = NEW_ISSUE.findall(review_text)
    # 同一 ID 可在后续轮次再次出现作为 Answer/Review 锚点；首次出现顺序须单调。
    first_seen: list[str] = []
    for issue_id in issue_ids:
        if issue_id not in first_seen:
            first_seen.append(issue_id)
    numeric_ids = [int(issue_id[1:]) for issue_id in first_seen]
    if numeric_ids and numeric_ids != sorted(numeric_ids):
        errors.append("新问题 ID 首次出现顺序必须单调递增")

    known_issue_ids = set(first_seen)
    status_events = STATUS_EVENT.findall(review_text)
    unknown_status_ids = sorted(
        {issue_id for issue_id, _ in status_events if issue_id not in known_issue_ids}
    )
    if unknown_status_ids:
        errors.append(
            f"状态事件引用了未定义问题：{', '.join(unknown_status_ids)}"
        )

    if PLACEHOLDER.search(review_text):
        errors.append("评审文档仍包含模板占位符")

    for term in FUZZY_TERMS:
        line_numbers = [
            str(index)
            for index, line in enumerate(document_text.splitlines(), start=1)
            if term in line
        ]
        if line_numbers:
            warnings.append(
                f"请检查 {document} 第 {', '.join(line_numbers)} 行中的模糊用语「{term}」"
            )

    branch = git_output("branch", "--show-current")
    if branch and not branch.startswith("review/"):
        errors.append(f"当前分支必须以 review/ 开头；实际为 {branch}")

    if mode == "complete":
        completed_count = len(
            re.findall(r"^## Review 完成\s*$", review_text, re.MULTILINE)
        )
        if completed_count != 1:
            errors.append(
                f"complete 模式要求恰好一个「## Review 完成」章节；实际为 {completed_count}"
            )
        if "* 最终状态：已完成" not in review_text:
            errors.append("Review 完成必须将最终状态设为已完成")
        if "* 未决技术点：0" not in review_text:
            errors.append("Review 完成必须将未决技术点设为 0")
        if "* 最终 Review 文档 Commit：当前记录所在 Commit" not in review_text:
            errors.append("Review 完成必须使用「当前记录所在 Commit」")
        completion_counts = dict(COMPLETION_COUNT.findall(review_text))
        expected_count_fields = {
            "Review 轮次",
            "已审阅技术点",
            "已确定技术结论",
            "已关闭问题",
            "未决技术点",
        }
        missing_count_fields = sorted(expected_count_fields - completion_counts.keys())
        if missing_count_fields:
            errors.append(
                f"Review 完成缺少数值字段：{', '.join(missing_count_fields)}"
            )
        else:
            if int(completion_counts["Review 轮次"]) != len(blocks):
                errors.append("Review 轮次必须等于轮次章节数")
            if int(completion_counts["已关闭问题"]) != len(known_issue_ids):
                errors.append("已关闭问题必须等于已定义问题数")
            if int(completion_counts["未决技术点"]) != 0:
                errors.append("未决技术点必须为 0")
            technical_points = int(completion_counts["已审阅技术点"])
            conclusions = int(completion_counts["已确定技术结论"])
            if technical_points < 1:
                errors.append("已审阅技术点至少为 1")
            if conclusions != technical_points:
                errors.append("已确定技术结论必须等于已审阅技术点")
        completed_time = re.search(
            r"^\* 完成时间：`?([^`\n]+)`?\s*$", review_text, re.MULTILINE
        )
        if not completed_time:
            errors.append("Review 完成必须包含完成时间")
        else:
            try:
                parsed_time = datetime.fromisoformat(completed_time.group(1))
                if parsed_time.tzinfo is None:
                    errors.append("完成时间必须包含时区")
            except ValueError:
                errors.append("完成时间必须是 ISO-8601 时间戳")
        latest_status: dict[str, str] = {}
        for issue_id, transition in status_events:
            latest_status[issue_id] = transition.split("→")[-1].strip()
        not_closed = sorted(
            issue_id
            for issue_id in known_issue_ids
            if latest_status.get(issue_id) != "已关闭"
        )
        if not_closed:
            errors.append(
                f"全部已定义问题最终状态必须为已关闭：{', '.join(not_closed)}"
            )
        _, answer_ids, review_ids = issue_event_coverage(review_text)
        missing_answers = sorted(known_issue_ids - answer_ids)
        missing_reviews = sorted(known_issue_ids - review_ids)
        if missing_answers:
            errors.append(
                f"缺少 Answer 事件的问题：{', '.join(missing_answers)}"
            )
        if missing_reviews:
            errors.append(
                f"缺少 Review 核实事件的问题：{', '.join(missing_reviews)}"
            )
        if blocks:
            final_block = blocks[-1][1]
            unresolved_section = final_block.split("### 未关闭问题", 1)
            if len(unresolved_section) != 2 or not re.search(
                r"^\s*\*\s*无\s*$", unresolved_section[1], re.MULTILINE
            ):
                errors.append("最终轮必须在「未关闭问题」下声明「* 无」")

    return errors, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description="校验技术文档评审结构")
    parser.add_argument("document", type=Path, help="技术文档路径")
    parser.add_argument("review", type=Path, help="评审文档路径")
    parser.add_argument(
        "--mode", choices=("round", "complete"), default="round", help="校验模式"
    )
    args = parser.parse_args()

    errors, warnings = validate(args.document, args.review, args.mode)
    for warning in warnings:
        print(f"WARNING: {warning}")
    for error in errors:
        print(f"ERROR: {error}", file=sys.stderr)

    if errors:
        return 1
    print(
        f"OK: {args.review} 满足 {args.mode} 结构不变量"
        f"（{len(warnings)} 条警告）"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
