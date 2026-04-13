import html
import re
from collections import Counter
from pathlib import Path


def main() -> None:
    s = Path("index.html").read_text(encoding="utf-8", errors="ignore")

    # Grab each eco-card anchor and extract the first <h4> title inside.
    cards = re.findall(r'<a\b[^>]*class="[^"]*\beco-card\b[^"]*"[^>]*>(.*?)</a>', s, flags=re.S | re.I)
    names: list[str] = []
    for c in cards:
        m = re.search(r"<h4[^>]*>(.*?)</h4>", c, flags=re.S | re.I)
        if not m:
            continue
        t = re.sub(r"<[^>]+>", "", m.group(1))
        t = html.unescape(t).strip()
        if t:
            names.append(t)

    uniq = set(names)
    cnt = Counter(names)
    dups = sorted([(n, c) for n, c in cnt.items() if c > 1], key=lambda x: (-x[1], x[0].lower()))

    print(f"unique_projects={len(uniq)}")
    print(f"total_cards={len(names)}")
    print(f"duplicate_titles={len(dups)}")
    print("top_duplicates=" + ", ".join([f"{n}×{c}" for n, c in dups[:15]]))


if __name__ == "__main__":
    main()

