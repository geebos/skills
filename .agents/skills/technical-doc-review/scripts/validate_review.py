#!/usr/bin/env python3
"""Validate the structural invariants of an append-only technical-doc review."""

from __future__ import annotations

import argparse
from datetime import datetime
import re
import subprocess
import sys
from pathlib import Path


ROUND_HEADING = re.compile(r"^## Review Round (\d+)\s*$", re.MULTILINE)
NEW_ISSUE = re.compile(r"^#### (R\d{3,})：[^\n]+$", re.MULTILINE)
STATUS_EVENT = re.compile(r"^- (R\d{3,})：([^\n]+)$", re.MULTILINE)
ANSWER_EVENT = re.compile(r"^#### (R\d{3,}) / Answer / Round \d+\s*$", re.MULTILINE)
REVIEW_EVENT = re.compile(r"^#### (R\d{3,}) / Review / Round \d+\s*$", re.MULTILINE)
PLACEHOLDER = re.compile(r"<(?:document-name|full-hash|YYYY-MM-DD|count|hash)")
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
    "本轮新增问题",
    "本轮确定的技术结论",
    "历史问题状态变更",
    "Answer 处理记录",
    "Review 复核结论",
    "本轮未关闭问题",
)
COMPLETION_COUNT = re.compile(
    r"^- (总 Review 轮次|已审阅技术点数量|已确定技术结论数量|已关闭问题数量|未决技术点数量)：(\d+)\s*$",
    re.MULTILINE,
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
        completed = text.find("\n## Review Completed", match.end(), end)
        if completed != -1:
            end = completed
        blocks.append((int(match.group(1)), text[match.start() : end]))
    return blocks


def validate(document: Path, review: Path, mode: str) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    if not document.is_file():
        errors.append(f"technical document does not exist: {document}")
    if not review.is_file():
        errors.append(f"review document does not exist: {review}")
        return errors, warnings

    expected_name = f"review-{document.name}"
    if review.name != expected_name:
        errors.append(f"review filename must be {expected_name}")

    review_text = review.read_text(encoding="utf-8")
    document_text = document.read_text(encoding="utf-8") if document.is_file() else ""

    blocks = round_blocks(review_text)
    numbers = [number for number, _ in blocks]
    if not blocks:
        errors.append("no Review Round section found")
    elif numbers != list(range(1, len(numbers) + 1)):
        errors.append(f"review rounds must be contiguous from 1; found {numbers}")

    for number, block in blocks:
        for section in REQUIRED_ROUND_SECTIONS:
            count = len(re.findall(rf"^### {re.escape(section)}\s*$", block, re.MULTILINE))
            if count != 1:
                errors.append(
                    f"Round {number} must contain exactly one '{section}' section; found {count}"
                )
        if "本轮完成 Commit：本记录所在 Commit" not in block:
            errors.append(
                f"Round {number} must use '本记录所在 Commit' for its self-referential commit"
            )
        for label in ("Review 起始 Commit", "当前技术文档版本"):
            if not re.search(
                rf"^- {re.escape(label)}：`?[0-9a-f]{{7,40}}`?\s*$",
                block,
                re.MULTILINE,
            ):
                errors.append(f"Round {number} must record a Git hash for {label}")
        if "- Review Agent：`technical_doc_reviewer`" not in block:
            errors.append(f"Round {number} must identify technical_doc_reviewer")
        if "- Answer Agent：`technical_doc_answerer`" not in block:
            errors.append(f"Round {number} must identify technical_doc_answerer")

    issue_ids = NEW_ISSUE.findall(review_text)
    duplicates = sorted({issue_id for issue_id in issue_ids if issue_ids.count(issue_id) > 1})
    if duplicates:
        errors.append(f"new issue IDs are defined more than once: {', '.join(duplicates)}")
    numeric_ids = [int(issue_id[1:]) for issue_id in issue_ids]
    if numeric_ids and numeric_ids != sorted(numeric_ids):
        errors.append("new issue IDs must increase monotonically")

    known_issue_ids = set(issue_ids)
    status_events = STATUS_EVENT.findall(review_text)
    unknown_status_ids = sorted(
        {issue_id for issue_id, _ in status_events if issue_id not in known_issue_ids}
    )
    if unknown_status_ids:
        errors.append(
            f"status events reference undefined issues: {', '.join(unknown_status_ids)}"
        )

    if PLACEHOLDER.search(review_text):
        errors.append("review document still contains template placeholders")

    for term in FUZZY_TERMS:
        line_numbers = [
            str(index)
            for index, line in enumerate(document_text.splitlines(), start=1)
            if term in line
        ]
        if line_numbers:
            warnings.append(
                f"inspect fuzzy term '{term}' in {document} at line(s) {', '.join(line_numbers)}"
            )

    branch = git_output("branch", "--show-current")
    if branch and not branch.startswith("review/"):
        errors.append(f"current branch must start with review/; found {branch}")

    if mode == "complete":
        completed_count = len(
            re.findall(r"^## Review Completed\s*$", review_text, re.MULTILINE)
        )
        if completed_count != 1:
            errors.append(
                f"complete mode requires exactly one Review Completed section; found {completed_count}"
            )
        if "- 最终状态：已完成" not in review_text:
            errors.append("Review Completed must set 最终状态 to 已完成")
        if "- 未决技术点数量：0" not in review_text:
            errors.append("Review Completed must set 未决技术点数量 to 0")
        if "- 最终 Review 文档 Commit：本记录所在 Commit" not in review_text:
            errors.append("Review Completed must use 本记录所在 Commit")
        completion_counts = dict(COMPLETION_COUNT.findall(review_text))
        expected_count_fields = {
            "总 Review 轮次",
            "已审阅技术点数量",
            "已确定技术结论数量",
            "已关闭问题数量",
            "未决技术点数量",
        }
        missing_count_fields = sorted(expected_count_fields - completion_counts.keys())
        if missing_count_fields:
            errors.append(
                f"Review Completed has missing numeric fields: {', '.join(missing_count_fields)}"
            )
        else:
            if int(completion_counts["总 Review 轮次"]) != len(blocks):
                errors.append("总 Review 轮次 must equal the number of round sections")
            if int(completion_counts["已关闭问题数量"]) != len(known_issue_ids):
                errors.append("已关闭问题数量 must equal the number of defined issues")
            if int(completion_counts["未决技术点数量"]) != 0:
                errors.append("未决技术点数量 must be 0")
            technical_points = int(completion_counts["已审阅技术点数量"])
            conclusions = int(completion_counts["已确定技术结论数量"])
            if technical_points < 1:
                errors.append("已审阅技术点数量 must be at least 1")
            if conclusions != technical_points:
                errors.append("已确定技术结论数量 must equal 已审阅技术点数量")
        completed_time = re.search(r"^- 完成时间：`?([^`\n]+)`?\s*$", review_text, re.MULTILINE)
        if not completed_time:
            errors.append("Review Completed must contain 完成时间")
        else:
            try:
                parsed_time = datetime.fromisoformat(completed_time.group(1))
                if parsed_time.tzinfo is None:
                    errors.append("完成时间 must include a timezone")
            except ValueError:
                errors.append("完成时间 must be an ISO-8601 timestamp")
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
                f"all defined issues must end in 已关闭: {', '.join(not_closed)}"
            )
        answer_ids = set(ANSWER_EVENT.findall(review_text))
        review_ids = set(REVIEW_EVENT.findall(review_text))
        missing_answers = sorted(known_issue_ids - answer_ids)
        missing_reviews = sorted(known_issue_ids - review_ids)
        if missing_answers:
            errors.append(
                f"issues missing Answer events: {', '.join(missing_answers)}"
            )
        if missing_reviews:
            errors.append(
                f"issues missing Review verification events: {', '.join(missing_reviews)}"
            )
        if blocks:
            final_block = blocks[-1][1]
            unresolved_section = final_block.split("### 本轮未关闭问题", 1)
            if len(unresolved_section) != 2 or not re.search(
                r"^\s*-\s*无\s*$", unresolved_section[1], re.MULTILINE
            ):
                errors.append("final round must declare '- 无' under 本轮未关闭问题")

    return errors, warnings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("document", type=Path)
    parser.add_argument("review", type=Path)
    parser.add_argument("--mode", choices=("round", "complete"), default="round")
    args = parser.parse_args()

    errors, warnings = validate(args.document, args.review, args.mode)
    for warning in warnings:
        print(f"WARNING: {warning}")
    for error in errors:
        print(f"ERROR: {error}", file=sys.stderr)

    if errors:
        return 1
    print(
        f"OK: {args.review} satisfies {args.mode} structural invariants "
        f"({len(warnings)} warning(s))"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
