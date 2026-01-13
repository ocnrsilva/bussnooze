
import { GoogleGenAI } from "@google/genai";

export const getTravelTips = async (destinationName: string) => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `O usuário está viajando para "${destinationName}" e quer tirar um cochilo no ônibus/trem. 
      Forneça 3 dicas de segurança extremamente curtas, diretas e impactantes para quem vai dormir no transporte público no Brasil. 
      Responda obrigatoriamente em Português do Brasil (pt-BR).
      Mantenha menos de 50 palavras no total. Formate como uma lista simples.`,
    });
    return response.text;
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Mantenha seus pertences junto ao corpo. Fique atento ao sinal do alarme. Boa viagem!";
  }
};
