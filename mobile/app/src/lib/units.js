// Полная конвертация единиц измерения. В БД всё хранится в метрике (вес - кг, рост - см);
// конвертация и форматирование выполняются только на границе UI по предпочтению user.units.
const LB_PER_KG = 2.20462262;

export const isImperial = (units) => units === "imperial";

export const kgToLb = (kg) => (Number(kg) || 0) * LB_PER_KG;
export const lbToKg = (lb) => (Number(lb) || 0) / LB_PER_KG;
export const cmToIn = (cm) => (Number(cm) || 0) / 2.54;
export const inToCm = (inch) => (Number(inch) || 0) * 2.54;

export function cmToFtIn(cm) {
  const totalIn = Math.round(cmToIn(cm));
  return { ft: Math.floor(totalIn / 12), in: totalIn % 12 };
}
export function ftInToCm(ft, inch) {
  return Math.round(inToCm((Number(ft) || 0) * 12 + (Number(inch) || 0)));
}

export const weightUnit = (units) => (isImperial(units) ? "фунт" : "кг");
export const heightUnit = (units) => (isImperial(units) ? "in" : "см");

// Метрика → отображаемое значение (число в единицах пользователя).
export function weightToDisplay(kg, units) {
  const v = Number(kg) || 0;
  return isImperial(units) ? Math.round(kgToLb(v)) : Math.round(v * 10) / 10;
}
// Отображаемое значение → кг (для отправки на сервер).
export function weightFromDisplay(val, units) {
  const v = Number(val) || 0;
  return isImperial(units) ? Math.round(lbToKg(v) * 10) / 10 : v;
}
// Рост: метрика → отображаемое (в дюймах для imperial, см для metric).
export function heightToDisplay(cm, units) {
  const v = Number(cm) || 0;
  return isImperial(units) ? Math.round(cmToIn(v)) : Math.round(v);
}
export function heightFromDisplay(val, units) {
  const v = Number(val) || 0;
  return isImperial(units) ? Math.round(inToCm(v)) : Math.round(v);
}

// Форматирование с единицей: "70 кг" / "154 фунт".
export function fmtWeight(kg, units) {
  if (kg == null || kg === "") return "-";
  return `${weightToDisplay(kg, units)} ${weightUnit(units)}`;
}
// Форматирование роста: "175 см" / "5′9″".
export function fmtHeight(cm, units) {
  if (cm == null || cm === "") return "-";
  if (isImperial(units)) { const { ft, in: i } = cmToFtIn(cm); return `${ft}′${i}″`; }
  return `${Math.round(cm)} см`;
}
