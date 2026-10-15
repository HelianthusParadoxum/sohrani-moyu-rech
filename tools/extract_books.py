"""Извлекает из PDF-списков книг колонки таблиц, разрезая страницы по горизонтальным линиям.

Строка таблицы начинается, если в первой колонке есть текст; строки без него
(продолжение на следующей странице) дописываются к предыдущей.
Использование: python3 -I tools/extract_books.py file.pdf [...] > out.json
"""
import json, sys, logging
import pdfplumber

logging.disable(logging.WARNING)

def extract(path):
    rows = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            words = page.extract_words()
            hdr_top = None
            for w in words:
                if w["text"] in ("Значки", "Название", "Жанр") and w["x0"] < 200:
                    hdr_top = w["top"]; break
            if hdr_top is None:
                continue
            hdr = sorted([w for w in words if abs(w["top"] - hdr_top) < 3], key=lambda w: w["x0"])
            xs = [hdr[0]["x0"]]
            for w in hdr[1:]:
                if w["x0"] - xs[-1] > 40: xs.append(w["x0"])
            ys = sorted(set(round(e["top"]) for e in page.edges if e["orientation"] == "h" and e["top"] > hdr_top + 5))
            ys = [y for i, y in enumerate(ys) if i == 0 or y - ys[i - 1] > 3]
            bands = list(zip([hdr_top + 8] + ys, ys + [page.height - 40]))
            for a, b in bands:
                cols = {}
                for w in words:
                    if a <= w["top"] < b:
                        c = max(k for k, x in enumerate(xs) if w["x0"] >= x - 6) if w["x0"] >= xs[0] - 6 else 0
                        cols.setdefault(c, []).append(w)
                if not cols: continue
                text = {c: " ".join(w["text"] for w in sorted(ws, key=lambda w: (round(w["top"]), w["x0"]))) for c, ws in cols.items()}
                if text.get(0) or not rows:
                    rows.append({k: v for k, v in text.items()})
                else:
                    for k, v in text.items():
                        rows[-1][k] = (rows[-1].get(k, "") + " " + v).strip()
    return [[r.get(i, "") for i in range(max(r) + 1)] for r in rows]

if __name__ == "__main__":
    json.dump({p: extract(p) for p in sys.argv[1:]}, sys.stdout, ensure_ascii=False, indent=1)
