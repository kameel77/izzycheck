import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { toExternalVinIdentification, type MapperInput } from "../mapper.ts";
import { parseVinXml } from "../parse.ts";
import type { ExternalVinIdentification } from "../types.ts";
import { FIXTURE_CARS, loadFixture, syntheticVin, type FixtureCar } from "./fixtures.ts";

const NOW = new Date("2026-10-28T12:00:00Z");

function rawFor(car: FixtureCar): MapperInput {
  return {
    classificationXml: loadFixture(`${car}.cls.xml`),
    fittedEquipmentCodes: parseVinXml(loadFixture(`${car}.vin.xml`))!.fittedEquipmentCodes,
  };
}

function mapCar(car: FixtureCar, vin = syntheticVin("K")): ExternalVinIdentification {
  return toExternalVinIdentification(vin, rawFor(car), NOW);
}

/** Podmienia wartość parametru klasyfikacji (albo usuwa parametr, gdy value === null). */
function withParam(xml: string, description: string, value: string | null): string {
  const re = new RegExp(`<Parameter><Value>[^<]*</Value><Description>${description}</Description><Id>\\d+</Id></Parameter>`);
  assert.match(xml, re, `parametr ${description} powinien istnieć w fixture`);
  return xml.replace(re, value === null ? "" : `<Parameter><Value>${value}</Value><Description>${description}</Description><Id>1</Id></Parameter>`);
}

function scalarsOf(result: ExternalVinIdentification): Array<[string, unknown]> {
  return Object.entries(result).filter(([key]) => key !== "carFeaturesBasicWithId" && key !== "carFeaturesAdditionalWithId");
}

describe("toExternalVinIdentification: pełne obiekty", () => {
  test("Kia Sportage: manual, FWD, benzyna, kombi TER", () => {
    const { carFeaturesBasicWithId, carFeaturesAdditionalWithId, ...scalars } = mapCar("kia-sportage");
    assert.deepEqual(scalars, {
      vin: syntheticVin("K"),
      make: "Kia",
      model: "Sportage IV 18-",
      manufacturerName: "Kia",
      constructionTime: null,
      constructionYear: "2019",
      body: "Sport Utility Vehicle (SUV)/Multi Purpose Vehicle (MPV)",
      subModelName: "1.6 GDi Top",
      doorsCount: "5",
      cubicCapacity: "1591",
      powerKw: "97",
      powerHp: "132",
      drive: "Front-wheel drive",
      transmission: "Manual/Standard",
      gearsCount: "6",
      fuelType: "Gasoline",
      tankVolume: "62",
      originalTireSizeAxle1: "225/60R17",
      batteryCapacityKWh: null,
      minimumTrunkCapacityL: "503",
      productType: "Car",
      maxLoadKg: "585",
      speedMax: "182",
      consumptionInTown: "8.2",
      consumptionOutOfTown: "6.6",
      co2Emission: "165",
      length: "4485",
      width: "1855",
      height: "1635",
      axlesCount: "2",
      wheelBase: "2670",
      airbagsCount: null,
      seatsCount: "5",
    });
    assert.equal(carFeaturesBasicWithId.length, 78);
    assert.deepEqual(carFeaturesBasicWithId[0], { label: "ABS", id: "B01" });
    assert.deepEqual(carFeaturesAdditionalWithId, [
      { label: "Lakier metalic", id: "L10" },
      { label: "Lakier perłowy", id: "L11" },
    ]);
  });

  test("BMW 420d: A8 Steptronic, 4x4, diesel, liftback, 18 opcji z VIN (nie 46 z katalogu)", () => {
    const { carFeaturesBasicWithId, carFeaturesAdditionalWithId, ...scalars } = mapCar("bmw-420d");
    assert.deepEqual(scalars, {
      vin: syntheticVin("K"),
      make: "BMW",
      model: "Seria 4 Gran Coupé Diesel F36 17-",
      manufacturerName: "BMW",
      constructionTime: null,
      constructionYear: "2019",
      body: "Hatchback/Liftback/Notchback",
      subModelName: "420d xDrive (A8)",
      doorsCount: "5",
      cubicCapacity: "1995",
      powerKw: "140",
      powerHp: "190",
      drive: "All wheel drive",
      transmission: "Automatic",
      gearsCount: "8",
      fuelType: "Diesel",
      tankVolume: "57",
      originalTireSizeAxle1: "225/50R17",
      batteryCapacityKWh: null,
      minimumTrunkCapacityL: "480",
      productType: "Car",
      maxLoadKg: "485",
      speedMax: "230",
      consumptionInTown: "5.2",
      consumptionOutOfTown: "4.1",
      co2Emission: "118",
      length: "4640",
      width: "1825",
      height: "1389",
      axlesCount: "2",
      wheelBase: "2810",
      airbagsCount: null,
      seatsCount: "5",
    });
    assert.equal(carFeaturesBasicWithId.length, 67);
    assert.equal(carFeaturesAdditionalWithId.length, 18);
    assert.deepEqual(
      carFeaturesAdditionalWithId.map((item) => item.id),
      ["K4B", "B1T", "K26", "L10", "B18", "B54", "B17", "K43", "K45", "O27", "O34", "K05", "B39", "K1B", "J16", "J40", "B51", "J71"],
    );
    assert.deepEqual(carFeaturesAdditionalWithId[1], { label: "Czujniki parkowania z przodu i z tyłu", id: "B1T" });
  });
});

describe("toExternalVinIdentification: pozostałe auta ze spike'a", () => {
  test("VW Arteon DSG -> Dual-clutch Transmission (DCT)", () => {
    const result = mapCar("vw-arteon");
    assert.equal(result.transmission, "Dual-clutch Transmission (DCT)");
    assert.equal(result.drive, "Front-wheel drive");
    assert.equal(result.fuelType, "Diesel");
  });

  test("Renault HEV (BAEL): benzyna, bateria z petrlCapacitySecondary, CUV, brak zużycia", () => {
    const result = mapCar("renault-arkana-hev");
    assert.equal(result.fuelType, "Gasoline");
    assert.equal(result.tankVolume, "50");
    assert.equal(result.batteryCapacityKWh, "1.2");
    assert.equal(result.body, "Crossover Utility Vehicle (CUV)");
    assert.equal(result.transmission, "Automatic");
    assert.equal(result.consumptionInTown, null);
    assert.equal(result.consumptionOutOfTown, null);
  });

  test("VW ID.3 (EL): tankVolume null, bateria z petrolCapacityMain, pojemność 0 -> null, CO2 0 zostaje", () => {
    const result = mapCar("vw-id3");
    assert.equal(result.fuelType, "Electric");
    assert.equal(result.tankVolume, null);
    assert.equal(result.batteryCapacityKWh, "58");
    assert.equal(result.cubicCapacity, null);
    assert.equal(result.co2Emission, "0");
    assert.equal(result.drive, "Rear-wheel drive");
  });
});

describe("toExternalVinIdentification: constructionYear", () => {
  const year = (yearChar: string, car: FixtureCar = "bmw-420d") => mapCar(car, syntheticVin(yearChar)).constructionYear;

  test("poprawny kod roku (BMW, productionBeginYear 2016)", () => {
    assert.equal(year("K"), "2019");
    assert.equal(year("H"), "2017");
    assert.equal(year("T"), "2026");
  });

  test("0, U i Z nie są kodami roku", () => {
    assert.equal(year("0"), null);
    assert.equal(year("U"), null);
    assert.equal(year("Z"), null);
  });

  test("rok przed productionBeginYear to null", () => {
    assert.equal(year("F"), null); // 2015 < 2016
    assert.equal(year("A", "kia-sportage"), null); // 2010 < 2017
  });

  test("rok w przyszłości: dopuszczony do bieżący rok + 1, dalej null", () => {
    assert.equal(year("V"), "2027"); // 2026 + 1
    assert.equal(year("W"), null); // 2028
    assert.equal(year("5"), null); // cyfra 5 = 2035
  });

  test("cykl 30-letni: cyfry 1-9 to lata 2031-2039", () => {
    const farFuture = toExternalVinIdentification(syntheticVin("1"), rawFor("bmw-420d"), new Date("2031-01-15T00:00:00Z"));
    assert.equal(farFuture.constructionYear, "2031");
  });

  test("bez productionBeginYear granica dolna nie obowiązuje", () => {
    const raw = rawFor("bmw-420d");
    const xml = withParam(raw.classificationXml, "productionBeginYear", null);
    assert.equal(toExternalVinIdentification(syntheticVin("F"), { ...raw, classificationXml: xml }, NOW).constructionYear, "2015");
  });
});

describe("toExternalVinIdentification: formaty wartości", () => {
  test("wszystkie wartości skalarne to string albo null; liczby bez przecinków", () => {
    for (const car of FIXTURE_CARS) {
      for (const [key, value] of scalarsOf(mapCar(car))) {
        assert.ok(value === null || typeof value === "string", `${car}.${key} to ${typeof value}`);
        if (typeof value === "string" && !["vin", "make", "model", "manufacturerName", "subModelName", "body", "drive", "transmission", "fuelType", "productType", "originalTireSizeAxle1"].includes(key)) {
          assert.doesNotMatch(value, /,/, `${car}.${key} zawiera przecinek`);
        }
      }
    }
  });

  test("opona bez spacji", () => {
    for (const car of FIXTURE_CARS) {
      const tire = mapCar(car).originalTireSizeAxle1;
      assert.match(tire ?? "", /^\d{3}\/\d{2}R\d{2}$/, `${car}: ${tire}`);
    }
  });

  test("pozycje wyposażenia mają label i id jako stringi", () => {
    for (const car of FIXTURE_CARS) {
      const result = mapCar(car);
      for (const item of [...result.carFeaturesBasicWithId, ...result.carFeaturesAdditionalWithId]) {
        assert.equal(typeof item.label, "string");
        assert.equal(typeof item.id, "string");
        assert.ok(item.id.length > 0);
      }
    }
  });

  test("pusty string, n/a i 0 dla wymiarów/pojemności dają null", () => {
    const raw = rawFor("kia-sportage");
    let xml = withParam(raw.classificationXml, "length", "0");
    xml = withParam(xml, "width", "n/a");
    xml = withParam(xml, "height", "");
    xml = withParam(xml, "storageSpace", "0");
    const result = toExternalVinIdentification(syntheticVin(), { ...raw, classificationXml: xml }, NOW);
    assert.equal(result.length, null);
    assert.equal(result.width, null);
    assert.equal(result.height, null);
    assert.equal(result.minimumTrunkCapacityL, null);
  });

  test("moc w KM liczona z kW, gdy Audatex jej nie podaje", () => {
    const raw = rawFor("kia-sportage");
    const xml = withParam(raw.classificationXml, "engineHP", null);
    const result = toExternalVinIdentification(syntheticVin(), { ...raw, classificationXml: xml }, NOW);
    assert.equal(result.powerKw, "97");
    assert.equal(result.powerHp, String(Math.round(97 * 1.35962)));
  });

  test("moc kW zaokrąglana do liczby całkowitej", () => {
    const raw = rawFor("kia-sportage");
    const xml = withParam(raw.classificationXml, "engineKW", "96,6");
    assert.equal(toExternalVinIdentification(syntheticVin(), { ...raw, classificationXml: xml }, NOW).powerKw, "97");
  });
});

describe("toExternalVinIdentification: słowniki", () => {
  const mapWith = (car: FixtureCar, overrides: Record<string, string | null>) => {
    const raw = rawFor(car);
    let xml = raw.classificationXml;
    for (const [description, value] of Object.entries(overrides)) xml = withParam(xml, description, value);
    return toExternalVinIdentification(syntheticVin(), { ...raw, classificationXml: xml }, NOW);
  };

  test("nieznana wartość słownikowa to null, nie surowa wartość Audatex", () => {
    const result = mapWith("kia-sportage", {
      engineFuelType: "XX",
      carBodyKind: "pikap",
      carBodyType: "pikap",
      axlePowered: "6x6",
      powerAxleLocation: "Q9",
      gearBox: "Q",
      VehicleCategory: "X1",
      kindCode: "ZZ",
    });
    assert.equal(result.fuelType, null);
    assert.equal(result.body, null);
    assert.equal(result.drive, null);
    assert.equal(result.transmission, null);
    assert.equal(result.productType, null);
    assert.equal(result.batteryCapacityKWh, null);
  });

  test("paliwa: BA, NM, EL, LPG, CNG, hybrydy BAEL/NMEL", () => {
    const fuel = (code: string) => mapWith("kia-sportage", { engineFuelType: code }).fuelType;
    assert.equal(fuel("BA"), "Gasoline");
    assert.equal(fuel("NM"), "Diesel");
    assert.equal(fuel("EL"), "Electric");
    assert.equal(fuel("LPG"), "Liquefied Petroleum Gas (propane or LPG)");
    assert.equal(fuel("CNG"), "Compressed Natural Gas (CNG)");
    assert.equal(fuel("BAEL"), "Gasoline");
    assert.equal(fuel("NMEL"), "Diesel");
  });

  test("nadwozie: wielkość liter nie ma znaczenia, fallback na carBodyType", () => {
    const body = (kind: string) => mapWith("kia-sportage", { carBodyKind: kind }).body;
    assert.equal(body("KOMBI ter"), "Sport Utility Vehicle (SUV)/Multi Purpose Vehicle (MPV)");
    assert.equal(body("SUV"), "Sport Utility Vehicle (SUV)/Multi Purpose Vehicle (MPV)");
    assert.equal(body("cuv"), "Crossover Utility Vehicle (CUV)");
    assert.equal(body("Hatchback"), "Hatchback/Liftback/Notchback");
    assert.equal(body("sedan"), "Sedan/Saloon");
    assert.equal(body("kombi"), "Wagon");
    assert.equal(body("kupe"), "Coupe");
    assert.equal(body("Coupe"), "Coupe");
    for (const cabrio of ["kabriolet", "cabrio", "roadster"]) assert.equal(body(cabrio), "Cabriolet/Convertible");
    assert.equal(mapWith("kia-sportage", { carBodyKind: "", carBodyType: "sedan" }).body, "Sedan/Saloon");
  });

  test("napęd: 4x4 lub P1Z1 -> AWD, P1 -> FWD, Z1 -> RWD", () => {
    assert.equal(mapWith("kia-sportage", { axlePowered: "4x4" }).drive, "All wheel drive");
    assert.equal(mapWith("kia-sportage", { powerAxleLocation: "P1Z1" }).drive, "All wheel drive");
    assert.equal(mapWith("kia-sportage", { powerAxleLocation: "Z1" }).drive, "Rear-wheel drive");
    assert.equal(mapWith("kia-sportage", {}).drive, "Front-wheel drive");
  });

  test("skrzynia: DCT/CVT po gearBoxType, inaczej A/M z gearBox", () => {
    const gearbox = (gearBoxType: string, gearBox: string) => mapWith("kia-sportage", { gearBoxType, gearBox }).transmission;
    for (const type of ["DSG", "S tronic", "PDK", "DCT", "EDC", "dsg 7"]) {
      assert.equal(gearbox(type, "A"), "Dual-clutch Transmission (DCT)", type);
    }
    for (const type of ["CVT", "Multitronic", "Xtronic"]) {
      assert.equal(gearbox(type, "A"), "Continuously Variable Transmission (CVT)", type);
    }
    assert.equal(gearbox("Steptronic", "A"), "Automatic");
    assert.equal(gearbox("n/a", "M"), "Manual/Standard");
  });

  test("typ pojazdu: OA lub M1* -> Car, N* -> Truck, L* -> Motorcycle", () => {
    const product = (kindCode: string, category: string) => mapWith("kia-sportage", { kindCode, VehicleCategory: category }).productType;
    assert.equal(product("OA", "N1"), "Car");
    assert.equal(product("XX", "M1G"), "Car");
    assert.equal(product("XX", "N1"), "Truck");
    assert.equal(product("XX", "L3e"), "Motorcycle");
    assert.equal(product("XX", "O1"), null);
  });
});

describe("toExternalVinIdentification: wyposażenie dodatkowe", () => {
  const map = (codes: string[]) =>
    toExternalVinIdentification(syntheticVin(), { classificationXml: loadFixture("kia-sportage.cls.xml"), fittedEquipmentCodes: codes }, NOW)
      .carFeaturesAdditionalWithId;

  test("nazwa z katalogu, gdy kodu nie ma na liście Optional klasyfikacji; inaczej sam kod", () => {
    assert.deepEqual(map(["B02", "ZZ9"]), [
      { label: "System EDL - el. blokada dyferencjału", id: "B02" },
      { label: "ZZ9", id: "ZZ9" },
    ]);
  });

  test("bez duplikatów i bez kodów obecnych w wyposażeniu seryjnym (Basic)", () => {
    assert.deepEqual(map(["L10", "L10", "B01"]), [{ label: "Lakier metalic", id: "L10" }]);
  });

  test("lista Optional klasyfikacji nie jest wyposażeniem auta: bez kodów z VIN lista jest pusta", () => {
    assert.deepEqual(map([]), []);
  });
});
