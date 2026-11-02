# Microsoft Store – podklady pre zápis (sk-SK)

## Základné údaje
- **Názov aplikácie (rezervovať v Partner Center):** Anonymo
- **Kategória:** Podnikanie (Business) · podkategória: Účtovníctvo a financie
- **Cena:** Zadarmo
- **Dostupnosť:** Slovensko, Česko (prípadne všetky trhy)
- **Vekové hodnotenie (IARC dotazník):** bez rizikového obsahu → 3+
- **Zásady ochrany súkromia (URL):** https://anonymo.shanoon.workers.dev/sukromie
- **Web:** https://shanoon.sk
- **Kontakt podpory:** info@shanoon.sk
- **Vyhlásenie o oprávneniach (runFullTrust):** Aplikácia potrebuje čítať a zapisovať súbory, ktoré používateľ vyberie (PDF, Word, Excel), a ukladať anonymizované kópie do zvoleného priečinka. Nekomunikuje so sieťou.

## Krátky popis (do 100 znakov)
Offline anonymizácia PDF, Word a Excel pred vložením do ChatGPT alebo Claude.

## Popis
Chcete využiť ChatGPT alebo Claude pri práci s dokumentmi klientov, ale nesmiete do nich vkladať osobné údaje? Anonymo ich za vás nájde a nahradí – priamo vo vašom počítači, bez internetu.

Pretiahnite do aplikácie PDF, Word alebo Excel súbory, zaškrtnite, čo chcete skryť, a kliknite na Anonymizovať. Aplikácia vytvorí kópie dokumentov, v ktorých sú citlivé údaje nahradené značkami ako [OSOBA_1], [IBAN_1] alebo [ICO_1]. Rovnaká osoba alebo firma dostane vo všetkých dokumentoch rovnakú značku – aj v rôznych pádoch (Novák, Nováka, Novákovi) – takže AI stále rozumie, kto je kto.

Čo aplikácia rozpozná:
• Mená osôb a názvy firiem
• Rodné čísla, dátumy narodenia, čísla OP a pasov
• IČO, DIČ, IČ DPH (s kontrolou platnosti)
• IBAN, čísla účtov, BIC/SWIFT, platobné karty, variabilné symboly
• Adresy, PSČ, telefóny, e-maily, webové adresy, EČV
• Vlastné výrazy, ktoré zadáte (napr. názov projektu)

Prečo je to bezpečné:
• 100 % offline – dokumenty ani ich obsah nikdy neopustia váš počítač
• Nič sa neukladá – žiadne kópie, logy ani zoznam nahradených údajov
• V PDF sú údaje skutočne odstránené, nie len prekryté čiernym obdĺžnikom
• Funguje aj na naskenovaných PDF (rozpoznávanie textu je súčasťou aplikácie)
• Vo Worde a Exceli zostáva zachované formátovanie, vzorce aj grafy; vyčistia sa aj komentáre, hlavičky, autori a metadáta

Vytvorené pre účtovníkov a účtovné kancelárie. Powered by Shanoon.

## Funkcie (Product features, max. 20 × 200 znakov)
1. Anonymizácia PDF, Word (.docx) a Excel (.xlsx) jedným kliknutím
2. Úplne offline – žiadne dáta sa neodosielajú
3. Rozpoznáva mená, rodné čísla, IČO, DIČ, IČ DPH, IBAN, adresy, telefóny a e-maily
4. Konzistentné značky [OSOBA_1] naprieč všetkými súbormi, aj pri skloňovaní mien
5. Skutočné odstránenie textu z PDF vrátane naskenovaných dokumentov (OCR)
6. Zachované formátovanie, vzorce a grafy vo Worde a Exceli
7. Vlastné výrazy na skrytie (názvy klientov, projektov)
8. Hromadné spracovanie viacerých súborov naraz

## Kľúčové slová (max. 7)
anonymizácia, GDPR, osobné údaje, účtovníctvo, ChatGPT, PDF, Excel

## Poznámky pre certifikáciu (Notes for certification)
Aplikácia nevyžaduje prihlásenie ani internet. Na test stačí pretiahnuť ľubovoľný PDF/DOCX/XLSX súbor s osobnými údajmi (napr. menom a IBAN) a kliknúť na „Anonymizovať“. Výsledok sa uloží vedľa pôvodného súboru s príponou „_anonymizovane“. Aplikácia je v slovenčine.

## Screenshoty
`store/screenshots/` – 2732×1536 px (okno 1366×768 @2x), fiktívne údaje:
1. `1-start.png` – úvodná obrazovka
2. `2-subory.png` – pridané súbory a výber údajov
3. `3-vysledok.png` – výsledok anonymizácie
