// Common Slovak & Czech given names. Used to find "Firstname Surname" pairs without the NER model
// and to boost NER confidence. Kept intentionally compact.
export const FIRST_NAMES = `
Adam Adrián Albert Alexander Alexej Alfréd Alojz Ambróz Andrej Anton Arnold Augustín Bartolomej Benedikt Beňadik
Bernard Blahoslav Blažej Bohdan Bohumil Bohuslav Boleslav Boris Branislav Bruno Ctibor Cyril Dalibor Daniel Dávid
Denis Dezider Dionýz Dominik Dušan Eduard Emil Erik Ernest Ervín Eugen Fedor Ferdinand Filip František Gabriel
Gejza Gregor Gustáv Henrich Hugo Ignác Igor Imrich Ivan Jakub Ján Jaromír Jaroslav Jerguš Jindřich Jiří Jozef
Július Juraj Kamil Karol Kazimír Koloman Kristián Kvetoslav Ladislav Leopold Levoslav Lukáš Ľubomír Ľuboš Ľudovít
Ľubor Marcel Marek Marián Martin Matej Matúš Maximilián Medard Metod Michal Mikuláš Milan Miloslav Miloš Miroslav
Mojmír Norbert Oldřich Oliver Ondrej Oskar Oto Pavol Patrik Peter Petr Pravoslav Radoslav Radovan Radim Rastislav
Richard Róbert Roland Roman Rudolf Samuel Sebastián Serafín Silvester Šimon Slavomír Stanislav Svätopluk Svetozár
Šebastián Štefan Tadeáš Teodor Tibor Tichomír Timotej Tomáš Urban Václav Valentín Valér Vavrinec Vendelín Viktor
Vincent Viliam Vladimír Vladislav Vlastimil Vojtech Zdenko Zdeněk Žigmund Zoltán Jan Josef Karel Pavel Jiri Jaromir
Adriana Agáta Agnesa Alena Alexandra Alica Alžbeta Andrea Anna Antónia Barbora Beáta Blanka Bohdana Bohumila Božena
Daniela Dana Darina Denisa Diana Dominika Dorota Drahomíra Edita Elena Eleonóra Eliška Ema Emília Erika Etela Eva
Filoména Františka Gabriela Galina Gizela Hana Hedviga Helena Henrieta Hermína Ingrida Irena Iveta Ivana Iveta Jana
Jarmila Jaroslava Jolana Jozefína Judita Júlia Juliana Justína Kamila Karolína Katarína Klára Kristína Kvetoslava
Ľubica Ľubomíra Ľudmila Laura Lea Lenka Lívia Lucia Ľudmila Magdaléna Marcela Margita Mária Mariana Marianna Marta
Martina Matilda Michaela Milada Milena Miriama Miroslava Monika Nadežda Natália Nikola Nina Nora Oľga Olívia Patrícia
Paulína Petra Petronela Radka Radoslava Regína Renáta Romana Rozália Ružena Sabína Silvia Simona Sláva Slávka Soňa
Stanislava Stela Svetlana Šarlota Tamara Tatiana Terézia Timea Valéria Vanda Veronika Viera Vieroslava Viktória
Vilma Viola Vlasta Xénia Zdenka Zita Zlata Zora Zuzana Žaneta Žofia Věra Jitka Kateřina Lucie Marie Tereza Zuzka
`
  .split(/\s+/)
  .filter(Boolean)

/** Academic/professional titles that typically precede a name. */
export const TITLES = [
  'Ing. arch.',
  'Ing.',
  'Mgr. art.',
  'Mgr.',
  'Bc.',
  'JUDr.',
  'MUDr.',
  'MDDr.',
  'MVDr.',
  'PhDr.',
  'RNDr.',
  'PaedDr.',
  'PharmDr.',
  'ThDr.',
  'ThLic.',
  'PhMr.',
  'Dr.',
  'doc.',
  'prof.',
  'Dipl.-Ing.',
  'Dipl. Ing.'
]

/** Suffix titles that follow a name. */
export const POST_TITLES = ['PhD.', 'Ph.D.', 'CSc.', 'DrSc.', 'MBA', 'LL.M.', 'MPH', 'DiS.', 'ArtD.']

/** Words that commonly start a sentence or label and must not be swallowed into a company/person name. */
export const LEADING_STOPWORDS = new Set(
  `spolocnost firma dodavatel odberatel objednavatel zhotovitel prenajimatel najomca klient faktura zmluva
  predavajuci kupujuci veritel dlznik poskytovatel prijimatel platitel zamestnavatel zamestnanec konatel
  pan pani pre od do a so s v na k o uhrada platba objednavka dobropis zalohova vystavil prevzal ucet
  obchodne meno nazov meno priezvisko a.s spol the company`
    .split(/\s+/)
    .filter(Boolean)
)

/** Location names too generic to be worth anonymizing when the NER model tags them (folded). */
export const GENERIC_LOCATIONS = new Set([
  'slovensko', 'slovenska republika', 'slovenskej republiky', 'slovenskou republikou', 'sr', 'slovakia',
  'ceska republika', 'ceskej republiky', 'cr', 'cesko', 'eu', 'europa', 'europska unia', 'europskej unie',
  'nemecko', 'rakusko', 'madarsko', 'polsko', 'ukrajina', 'usa', 'svet'
])
