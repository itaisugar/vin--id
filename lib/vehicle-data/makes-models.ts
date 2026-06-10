/**
 * Local, static make/model data for the Add/Edit Vehicle combobox.
 *
 * Free-tier friendly: no external APIs, no VIN decoding — just a practical MVP
 * list of common car and motorcycle makes with a handful of popular models
 * each. Users can always type a custom make/model that isn't listed, so this
 * does not need to be exhaustive.
 */

export interface VehicleMake {
  name: string;
  models: string[];
}

export const VEHICLE_MAKES: VehicleMake[] = [
  // --- Cars ---
  {
    name: "Toyota",
    models: [
      "Corolla",
      "Camry",
      "RAV4",
      "Yaris",
      "Hilux",
      "Land Cruiser",
      "Prius",
      "C-HR",
      "Highlander",
      "Supra",
      "Auris",
    ],
  },
  {
    name: "Honda",
    models: ["Civic", "Accord", "CR-V", "Jazz", "HR-V", "Pilot", "City", "Fit"],
  },
  {
    name: "Ford",
    models: [
      "Fiesta",
      "Focus",
      "Mustang",
      "F-150",
      "Explorer",
      "Escape",
      "Kuga",
      "Ranger",
      "Puma",
      "Transit",
    ],
  },
  {
    name: "Chevrolet",
    models: [
      "Spark",
      "Cruze",
      "Malibu",
      "Camaro",
      "Corvette",
      "Silverado",
      "Equinox",
      "Tahoe",
      "Trax",
    ],
  },
  {
    name: "Nissan",
    models: [
      "Micra",
      "Sentra",
      "Altima",
      "Qashqai",
      "X-Trail",
      "Juke",
      "Leaf",
      "Navara",
      "GT-R",
      "Note",
    ],
  },
  {
    name: "Hyundai",
    models: [
      "i10",
      "i20",
      "i30",
      "Elantra",
      "Tucson",
      "Santa Fe",
      "Kona",
      "Ioniq",
      "Accent",
      "Sonata",
    ],
  },
  {
    name: "Kia",
    models: [
      "Picanto",
      "Rio",
      "Ceed",
      "Sportage",
      "Sorento",
      "Niro",
      "Stonic",
      "Stinger",
      "Soul",
      "EV6",
    ],
  },
  {
    name: "Mazda",
    models: [
      "Mazda2",
      "Mazda3",
      "Mazda6",
      "CX-3",
      "CX-5",
      "CX-30",
      "MX-5",
      "CX-9",
    ],
  },
  {
    name: "Subaru",
    models: ["Impreza", "Legacy", "Outback", "Forester", "XV", "BRZ", "WRX"],
  },
  {
    name: "Volkswagen",
    models: [
      "Polo",
      "Golf",
      "Passat",
      "Tiguan",
      "T-Roc",
      "Touareg",
      "Arteon",
      "ID.3",
      "ID.4",
      "Jetta",
    ],
  },
  {
    name: "BMW",
    models: [
      "1 Series",
      "2 Series",
      "3 Series",
      "5 Series",
      "7 Series",
      "X1",
      "X3",
      "X5",
      "X6",
      "i4",
      "M3",
    ],
  },
  {
    name: "Mercedes-Benz",
    models: [
      "A-Class",
      "B-Class",
      "C-Class",
      "E-Class",
      "S-Class",
      "GLA",
      "GLC",
      "GLE",
      "CLA",
      "V-Class",
    ],
  },
  {
    name: "Audi",
    models: [
      "A1",
      "A3",
      "A4",
      "A5",
      "A6",
      "Q2",
      "Q3",
      "Q5",
      "Q7",
      "e-tron",
      "TT",
    ],
  },
  {
    name: "Lexus",
    models: ["IS", "ES", "LS", "NX", "RX", "UX", "GX", "LC"],
  },
  {
    name: "Tesla",
    models: ["Model 3", "Model Y", "Model S", "Model X", "Cybertruck"],
  },
  {
    name: "Volvo",
    models: ["V40", "V60", "V90", "S60", "S90", "XC40", "XC60", "XC90"],
  },
  {
    name: "Peugeot",
    models: [
      "108",
      "208",
      "308",
      "2008",
      "3008",
      "5008",
      "508",
      "Partner",
    ],
  },
  {
    name: "Renault",
    models: [
      "Clio",
      "Megane",
      "Captur",
      "Kadjar",
      "Koleos",
      "Scenic",
      "Zoe",
      "Talisman",
      "Duster",
    ],
  },
  {
    name: "Skoda",
    models: [
      "Fabia",
      "Octavia",
      "Superb",
      "Scala",
      "Kamiq",
      "Karoq",
      "Kodiaq",
      "Enyaq",
    ],
  },
  {
    name: "Seat",
    models: ["Ibiza", "Leon", "Arona", "Ateca", "Tarraco", "Toledo"],
  },
  {
    name: "Fiat",
    models: ["500", "Panda", "Tipo", "Punto", "500X", "500L", "Doblo"],
  },
  {
    name: "Jeep",
    models: [
      "Renegade",
      "Compass",
      "Cherokee",
      "Grand Cherokee",
      "Wrangler",
      "Gladiator",
    ],
  },
  {
    name: "Mitsubishi",
    models: [
      "Mirage",
      "Lancer",
      "ASX",
      "Outlander",
      "Eclipse Cross",
      "Pajero",
      "L200",
    ],
  },
  {
    name: "Suzuki",
    models: [
      "Swift",
      "Baleno",
      "Vitara",
      "S-Cross",
      "Jimny",
      "Ignis",
      "Celerio",
    ],
  },
  {
    name: "Isuzu",
    models: ["D-Max", "MU-X"],
  },
  {
    name: "Land Rover",
    models: [
      "Defender",
      "Discovery",
      "Discovery Sport",
      "Range Rover",
      "Range Rover Sport",
      "Range Rover Evoque",
      "Range Rover Velar",
    ],
  },
  {
    name: "Porsche",
    models: [
      "911",
      "718 Cayman",
      "718 Boxster",
      "Panamera",
      "Macan",
      "Cayenne",
      "Taycan",
    ],
  },
  {
    name: "Mini",
    models: ["Cooper", "Cooper S", "Clubman", "Countryman", "Convertible"],
  },
  {
    name: "Opel",
    models: [
      "Corsa",
      "Astra",
      "Insignia",
      "Mokka",
      "Crossland",
      "Grandland",
      "Combo",
    ],
  },
  {
    name: "Citroen",
    models: ["C1", "C3", "C4", "C5 Aircross", "C3 Aircross", "Berlingo"],
  },
  {
    name: "Genesis",
    models: ["G70", "G80", "G90", "GV70", "GV80"],
  },
  {
    name: "BYD",
    models: ["Atto 3", "Dolphin", "Seal", "Han", "Tang"],
  },
  {
    name: "MG",
    models: ["MG3", "MG4", "MG5", "ZS", "HS", "MG6"],
  },
  {
    name: "Chery",
    models: ["Tiggo 2", "Tiggo 4", "Tiggo 7", "Tiggo 8", "Arrizo 5"],
  },
  {
    name: "Geely",
    models: ["Coolray", "Azkarra", "Emgrand", "Tugella"],
  },
  {
    name: "Great Wall",
    models: ["Wingle 5", "Wingle 7", "Poer", "Steed"],
  },

  // --- Motorcycles ---
  {
    name: "Yamaha",
    models: [
      "YZF-R1",
      "YZF-R3",
      "YZF-R6",
      "MT-03",
      "MT-07",
      "MT-09",
      "Tracer 900",
      "XSR700",
      "Tenere 700",
    ],
  },
  {
    name: "Honda Motorcycles",
    models: [
      "CBR500R",
      "CBR650R",
      "CBR1000RR",
      "CB500F",
      "CB650R",
      "CRF300L",
      "Africa Twin",
      "Rebel 500",
      "Gold Wing",
      "PCX",
    ],
  },
  {
    name: "Kawasaki",
    models: [
      "Ninja 400",
      "Ninja 650",
      "Ninja ZX-6R",
      "Ninja ZX-10R",
      "Z400",
      "Z650",
      "Z900",
      "Versys 650",
      "Vulcan S",
    ],
  },
  {
    name: "Suzuki Motorcycles",
    models: [
      "GSX-R600",
      "GSX-R750",
      "GSX-R1000",
      "SV650",
      "V-Strom 650",
      "V-Strom 1050",
      "Hayabusa",
      "GSX-S750",
    ],
  },
  {
    name: "BMW Motorrad",
    models: [
      "R 1250 GS",
      "F 850 GS",
      "S 1000 RR",
      "R nineT",
      "F 900 R",
      "G 310 R",
      "R 1250 RT",
    ],
  },
  {
    name: "Harley-Davidson",
    models: [
      "Iron 883",
      "Forty-Eight",
      "Street Glide",
      "Road King",
      "Fat Boy",
      "Sportster S",
      "Softail",
    ],
  },
  {
    name: "Ducati",
    models: [
      "Panigale V2",
      "Panigale V4",
      "Monster",
      "Multistrada",
      "Diavel",
      "Scrambler",
      "Streetfighter",
    ],
  },
  {
    name: "KTM",
    models: [
      "Duke 390",
      "Duke 790",
      "RC 390",
      "1290 Super Duke",
      "390 Adventure",
      "890 Adventure",
    ],
  },
  {
    name: "Triumph",
    models: [
      "Street Triple",
      "Speed Triple",
      "Bonneville",
      "Tiger 900",
      "Trident 660",
      "Rocket 3",
      "Scrambler 1200",
    ],
  },
];

/** Trim a make name for consistent comparison/storage. */
export function normalizeMakeName(make: string): string {
  return make.trim();
}

/** All known make names, in display order. */
export function getVehicleMakes(): string[] {
  return VEHICLE_MAKES.map((m) => m.name);
}

/**
 * Models for a given make. Match is case-insensitive and whitespace-tolerant so
 * a stored/custom make like "toyota " still resolves. Returns an empty array
 * for unknown/custom makes (the combobox then accepts free text).
 */
export function getModelsForMake(make: string): string[] {
  const target = normalizeMakeName(make).toLowerCase();
  if (!target) return [];
  const entry = VEHICLE_MAKES.find((m) => m.name.toLowerCase() === target);
  return entry ? entry.models : [];
}
