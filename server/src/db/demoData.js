// Справочник демо-данных: комбинат, школы, поставщики, блюда.
// take - какая доля пришедших детей берёт блюдо, eat - какую долю порции съедает взявший.

const KOMBINAT = "Полиграф комбинат";

const SUPPLIERS = ["ООО «МясоПтица»", "ООО «Овощная база»", "АО «Молочный двор»", "ООО «Хлебный дом»", "ООО «Сады Кубани»"];

const SCHOOLS = [
  { number: 33, name: "Гимназия №33", director: "Смирнова Анна Петровна", students: 900 },
  { number: 11, name: "Школа №11", director: "Козлов Сергей Иванович", students: 640 },
  { number: 21, name: "Школа №21", director: "Морозова Елена Викторовна", students: 520 }
];

const DISHES = [
  { name: "Борщ", slug: "borscht", category: "soup", grams: 250, price: 48, supplier: 1, take: 0.62, eat: 0.88 },
  { name: "Щи", slug: "shchi", category: "soup", grams: 250, price: 42, supplier: 1, take: 0.66, eat: 0.86 },
  { name: "Гороховый суп", slug: "pea-soup", category: "soup", grams: 250, price: 45, supplier: 0, take: 0.88, eat: 0.94 },
  { name: "Куриный суп с лапшой", slug: "chicken-noodle-soup", category: "soup", grams: 250, price: 50, supplier: 0, take: 0.93, eat: 0.96 },
  { name: "Котлеты", slug: "cutlets", category: "main", grams: 90, price: 62, supplier: 0, take: 0.97, eat: 0.97 },
  { name: "Рыбные котлеты", slug: "fish-cutlets", category: "main", grams: 90, price: 58, supplier: 0, take: 0.7, eat: 0.75 },
  { name: "Тефтели", slug: "meatballs", category: "main", grams: 100, price: 60, supplier: 0, take: 0.92, eat: 0.95 },
  { name: "Плов", slug: "plov", category: "main", grams: 200, price: 75, supplier: 0, take: 0.97, eat: 0.97 },
  { name: "Пюре", slug: "mashed-potatoes", category: "side", grams: 150, price: 28, supplier: 1, take: 0.95, eat: 0.96 },
  { name: "Гречка", slug: "buckwheat", category: "side", grams: 150, price: 22, supplier: 1, take: 0.78, eat: 0.9 },
  { name: "Макароны", slug: "pasta", category: "side", grams: 150, price: 20, supplier: 3, take: 0.97, eat: 0.97 },
  { name: "Рис", slug: "rice", category: "side", grams: 150, price: 22, supplier: 1, take: 0.88, eat: 0.93 },
  { name: "Салат", slug: "cabbage-salad", category: "salad", grams: 100, price: 18, supplier: 1, take: 0.68, eat: 0.85 },
  { name: "Винегрет", slug: "vinegret", category: "salad", grams: 100, price: 20, supplier: 1, take: 0.55, eat: 0.7 },
  { name: "Салат из свёклы", slug: "beet-salad", category: "salad", grams: 100, price: 18, supplier: 1, take: 0.62, eat: 0.82 },
  { name: "Компот", slug: "kompot", category: "drink", grams: 200, price: 12, supplier: 4, take: 0.98, eat: 0.98 },
  { name: "Чай", slug: "tea", category: "drink", grams: 200, price: 6, supplier: 2, take: 0.92, eat: 0.97 },
  { name: "Кисель", slug: "kissel", category: "drink", grams: 200, price: 14, supplier: 4, take: 0.85, eat: 0.94 }
];

// Меню на следующий учебный день - как в макете Figma.
const NEXT_DAY_MENU = ["Борщ", "Котлеты", "Пюре", "Салат", "Компот"];

// Аппетит по дням недели (1 = пн): в среду дети едят заметно меньше - на этом строится
// рекомендация из макета «В среду дети едят меньше».
const WEEKDAY_APPETITE = { 1: 1.0, 2: 1.02, 3: 0.9, 4: 1.0, 5: 0.97 };

module.exports = { KOMBINAT, SUPPLIERS, SCHOOLS, DISHES, NEXT_DAY_MENU, WEEKDAY_APPETITE };
