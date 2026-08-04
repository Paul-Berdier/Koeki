export const ninjas = [
  { code: "NIN-000041", name: "Aoki Hoki", alias: "La Cigale", grade: "Chunin", points: 2440, debt: 0, status: "paid" as const, agent: "Sonemi H.", due: "—" },
  { code: "NIN-000058", name: "Araki Hoki", alias: "", grade: "Jonin", points: 2000, debt: 32000, status: "overdue" as const, agent: "Sonemi H.", due: "2 ans RP" },
  { code: "NIN-000063", name: "Inao Hoki", alias: "Sirocco", grade: "Genin confirmé", points: 500, debt: 0, status: "paid" as const, agent: "Kaemon T.", due: "—" },
  { code: "NIN-000072", name: "Izen Hoki", alias: "", grade: "Tokubetsu Jonin", points: 1290, debt: 8000, status: "due" as const, agent: "Kaemon T.", due: "4 jours" },
  { code: "NIN-000087", name: "Kagami Hoki", alias: "L’Œil du désert", grade: "Konin", points: 0, debt: 27000, status: "overdue" as const, agent: "Sonemi H.", due: "2 ans RP" },
  { code: "NIN-000094", name: "Tao Hoki", alias: "", grade: "Jonin", points: 2000, debt: 56000, status: "overdue" as const, agent: "Kaemon T.", due: "4 ans RP" },
  { code: "NIN-000109", name: "Yukiro Hoki", alias: "", grade: "Chunin", points: 860, debt: 15000, status: "warning" as const, agent: "Sonemi H.", due: "1 jour" }
];

export const activity = [
  { code: "PAY-2026-000184", label: "Paiement de taxe", subject: "Aoki Hoki", amount: 15000, time: "Il y a 18 min", kind: "in" },
  { code: "BUY-2026-000067", label: "Rachat de ressources", subject: "Mina Sabaku", amount: -8400, time: "Il y a 42 min", kind: "out" },
  { code: "DON-2026-000031", label: "Don enregistré", subject: "Sora Kaze", amount: 4200, time: "Il y a 1 h", kind: "gift" },
  { code: "ADJ-2026-000012", label: "Remise validée", subject: "Izen Hoki", amount: -2000, time: "Il y a 2 h", kind: "adjust" }
];
