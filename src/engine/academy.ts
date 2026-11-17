export interface Lesson {
  id: string;
  title: string;
  body: string;
  question: string;
  choices: string[];
  answer: number;
}

export const LESSONS: Lesson[] = [
  {
    id: "stop",
    title: "Stop",
    body: "El stop es el precio en el que aceptas cerrar la simulación si el mercado va en contra. En la ronda unida, si el objetivo y el stop se tocan en el mismo minuto, cuenta el stop.",
    question: "¿Qué pasa si la misma vela de 1 minuto toca el objetivo y el stop?",
    choices: ["Cuenta el objetivo", "Cuenta el stop", "Se anula y se inventa un precio medio"],
    answer: 1,
  },
  {
    id: "objetivo",
    title: "Objetivo",
    body: "El objetivo es el precio al que cierras si el mercado va a favor. En la ronda unida está a 1,5 veces la distancia del stop, calculada con velas reales.",
    question: "En la ronda unida, ¿cómo se coloca el objetivo respecto al stop?",
    choices: ["A la misma distancia", "A 1,5 veces la distancia del stop", "Siempre a un 10%"],
    answer: 1,
  },
  {
    id: "rr",
    title: "Relación R:R",
    body: "R:R compara lo que puedes ganar con lo que arriesgas. En el modo libre hace falta al menos 0,25: el objetivo no puede ser ridículo frente al stop.",
    question: "Si arriesgas 4 y el objetivo paga 1, ¿la relación es válida en el modo libre?",
    choices: ["Sí, 0,25 está permitido", "No, hace falta al menos 1", "Solo si el activo es BTC"],
    answer: 0,
  },
  {
    id: "apalancamiento",
    title: "Apalancamiento",
    body: "El apalancamiento multiplica la exposición con el mismo margen simulado y acerca la liquidación. No mueve dinero real. Un 2x no es el doble de acierto: es el doble de sensibilidad al precio.",
    question: "¿Qué acerca el apalancamiento?",
    choices: ["El precio de liquidación a la entrada", "La garantía de ganar", "La comisión a cero"],
    answer: 0,
  },
  {
    id: "riesgo",
    title: "Riesgo",
    body: "El riesgo es la parte de la cuenta simulada que puedes perder en una idea. Un stop del 10% es el máximo del modo libre. Si no hay precio ejecutable, no se abre la operación.",
    question: "¿Cuál es el stop máximo del modo libre?",
    choices: ["1%", "10%", "No hay límite"],
    answer: 1,
  },
];

export function gradeLesson(id: string, choice: number): boolean {
  const lesson = LESSONS.find((item) => item.id === id);
  return Boolean(lesson && choice === lesson.answer);
}

export const ACADEMY_BADGE = { id: "academia", name: "Academia", hint: "Aprueba las cinco lecciones." };
