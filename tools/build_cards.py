"""Собирает src/data/cards.json из PDF-списков книг (docs/source/*.pdf).

Механика карты определяется только колонкой «Значки» и разделом документа;
название и автор — для отображения. Запуск: npm run data
"""
import json, re, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from extract_books import extract

G = {"ПР": "prose", "ФА": "scifi", "ПО": "poetry", "ИН": "foreign",
     "СВ": "testimony", "АЛ": "album", "ИР": "irony", "ДР": "drama"}
G_RU = {"Проза": "prose", "Фантастика": "scifi", "Поэзия": "poetry", "Иностранная": "foreign",
        "Свидетельства": "testimony", "Альбом": "album", "Ирония": "irony", "Драматургия": "drama"}

def clean(s):
    s = re.sub(r"\s+", " ", s.replace("\x00", "×")).strip()
    return s

def author_of(s):
    s = clean(s)
    m = re.search(r"Автор — (.+)$", s)
    return m.group(1).strip() if m else s

cards = []
def add(kind, title, author, icons=(), genre=None, returned=None):
    cards.append({"id": f"c{len(cards)+1:03d}", "kind": kind, "title": clean(title),
                  "author": author_of(author), "icons": list(icons),
                  **({"genre": genre} if genre else {}), **({"returned": returned} if returned else {})})

for path in ("docs/source/books-genres-1-4.pdf", "docs/source/books-genres-5-8.pdf"):
    for r in extract(path):
        m = re.match(r"^(ПР|ФА|ПО|ИН|СВ|АЛ|ИР|ДР)\s*(.*)$", clean(r[0]))
        if not m or len(r) < 3: continue
        g, rest = G[m.group(1)], m.group(2)
        n = 2 if re.search(r"[×хx]\s*2|^2$", rest) else 1
        add("genre", r[1], r[2], [g] * n)

for r in extract("docs/source/books-dual-evidence-propaganda.pdf"):
    c0 = clean(r[0])
    m = re.match(r"^(ПР|ФА|ПО|ИН|СВ|АЛ|ИР|ДР) \+ (ПР|ФА|ПО|ИН|СВ|АЛ|ИР|ДР)$", c0)
    if m: add("genre", r[1], r[2], [G[m.group(1)], G[m.group(2)]]); continue
    if c0 == "ЧНЛ": add("propaganda", r[1], r[2]); continue
    if len(r) >= 4 and re.match(r"^\d{4}", clean(r[2])) and c0 not in ("Название",):
        add("evidence", r[0], r[1])

for r in extract("docs/source/books-nagruzka.pdf"):
    c0 = clean(r[0])
    first = c0.split(" ")[0]
    if first in G_RU and len(r) >= 3:
        # «Жанр Автор | Плакатное | Возвращённое ...» — названия в PDF перемешаны, храним как есть.
        add("loadReturnable", r[1], " ".join(c0.split(" ")[1:]), genre=G_RU[first], returned=clean(r[2])[:80])
    elif first == "Улика":
        add("loadEvidence", r[1], c0[len("Улика"):])
    elif c0 and c0 not in ("Название",) and not c0.startswith(("Возвращаемая", "Жанр")) and len(r) >= 2:
        add("load", r[0], r[1])

# Колонки «Возвращаемой нагрузки» и Улик в PDF сливаются — названия заданы вручную по документу «Нагрузка».
RETURNABLE = {
    "prose": ("Мать", "Несвоевременные мысли", "Максим Горький"),
    "poetry": ("Владимир Ильич Ленин", "Письма к Лиле Брик", "Владимир Маяковский"),
    "scifi": ("Туманность Андромеды", "Час Быка", "Иван Ефремов"),
    "drama": ("Шестое июля", "Брестский мир", "Михаил Шатров"),
    "irony": ("Рассказы о Ленине", "Голубая книга", "Михаил Зощенко"),
    "testimony": ("Буря", "Люди, годы, жизнь", "Илья Эренбург"),
    "album": ("Выполним пятилетку в 4 года", "Динамический город", "Густав Клуцис"),
    "foreign": ("Рукопожатия", "Одна фраза о тирании", "Дьюла Ийеш"),
}
for c in cards:
    if c["kind"] == "loadReturnable":
        c["title"], c["returned"], c["author"] = RETURNABLE[c["genre"]]
LOAD_EVIDENCE = [("О преодолении культа личности и его последствий", "Никита Хрущёв"),
                 ("Разоблачения дипломатической истории XVIII века", "Карл Маркс, Фридрих Энгельс")]
for c, (t, a) in zip([c for c in cards if c["kind"] == "loadEvidence"], LOAD_EVIDENCE):
    c["title"], c["author"] = t, a
if not any(c["title"].startswith("Письма к Луначарскому") for c in cards):
    add("evidence", "Письма к Луначарскому", "Владимир Короленко")
for c in cards:
    if c["kind"] == "evidence":
        c["author"] = re.split(r"[;(]", c["author"])[0].strip()
        c["title"] = c["title"].replace("Беломорско- Балтийский", "Беломорско-Балтийский").replace("Очерк- путеводитель", "Очерк-путеводитель")
    if c["kind"] == "propaganda":
        c["author"] = re.split(r"[;(]", c["author"])[0].strip()

# Строки, где колонки в PDF съехали: (начало названия в PDF) → (название, автор).
FIX = {
    "Архипелаг ГУЛАГ": ("Архипелаг ГУЛАГ", "Александр Солженицын"),
    "Чёрная книга": ("Чёрная книга", "Василий Гроссман, Илья Эренбург (ред.)"),
    "Барак и забор": ("Барак и забор", "Оскар Рабин"),
    "Двойной": ("Двойной автопортрет", "Виталий Комар и Александр Меламид"),
    "Автор — Владимир Башня": ("Башня Татлина", "Владимир Татлин"),
    "Эрнст Ядерный": ("Ядерный взрыв", "Эрнст Неизвестный"),
    "Лагерная сюита": ("Лагерная сюита", "Борис Свешников"),
    "Глаз-яйцо": ("Глаз-яйцо", "Юло Соостер"),
    "Жизнь и необычайные": ("Жизнь и необычайные приключения солдата Ивана Чонкина", "Владимир Войнович"),
    "Случаи": ("Случаи", "Даниил Хармс"),
    "Сергей Заповедник": ("Заповедник", "Сергей Довлатов"),
    "Александр Женщина": ("Женщина у окна", "Александр Древин"),
    "Борис Доктор Живаго": ("Доктор Живаго", "Борис Пастернак"),
    "Урания": ("Урания / To Urania", "Иосиф Бродский"),
    "Сколько стоит": ("Сколько стоит человек", "Евфросиния Керсновская"),
    "Шутка": ("Шутка", "Милан Кундера"),
    "Андрей Восток": ("Восток — Запад", "Андрей Амальрик"),
    "Панно для": ("Панно для Еврейского камерного театра", "Марк Шагал"),
    "Тёркин": ("Тёркин на том свете", "Александр Твардовский"),
    "За миллиард": ("За миллиард лет до конца света", "Аркадий и Борис Стругацкие"),
    "Калигула": ("Калигула", "Альбер Камю"),
    "Повесть Борис": ("Повесть непогашенной луны", "Борис Пильняк"),
    "Вшкафусидящий": ("Вшкафусидящий Примаков", "Илья Кабаков"),
    "Звуки": ("Звуки", "Василий Кандинский"),
    "Солярис": ("Солярис", "Станислав Лем"),
    "Москва — Венедикт": ("Москва — Петушки", "Венедикт Ерофеев"),
    "Фрида Судилище": ("Судилище", "Фрида Вигдорова"),
    "Георгий Верный": ("Верный Руслан", "Георгий Владимов"),
    "Цикл «Баухаус»": ("Цикл «Баухаус»", "Вера Ермолаева"),
}
for c in cards:
    for k, (t, a) in FIX.items():
        if c["title"].startswith(k):
            c["title"], c["author"] = t, a
    c["author"] = re.sub(r"\s*Авторство\s*", " ", c["author"]).strip()
    c["author"] = re.sub(r"^Перевод — .*?Автор — ", "", c["author"])
    c["author"] = re.sub(r"\s*\(.*$", "", c["author"]) if c["author"].startswith("Перевод") else c["author"]

# Нагрузка-пропаганда (добавлена автором вручную): у книжников — Нагрузка, у Куратора — Пропаганда.
add("loadPropaganda", "Полное собрание сочинений", "Владимир Ленин")
# Уникальная карта «Чукоккала» (добавлена автором вручную): 1 значок любого жанра — в каждом подсчёте того, что выгоднее;
# жанровых свойств не имеет. Лежит в стопке Непечатных.
add("genre", "Чукоккала", "Корней Чуковский")
cards[-1]["wild"] = True

json.dump(cards, open("src/data/cards.json", "w"), ensure_ascii=False, indent=1)
from collections import Counter
print(Counter(c["kind"] for c in cards))
print(Counter((c["kind"], len(c["icons"])) for c in cards))
print(Counter(i for c in cards for i in c["icons"]))
