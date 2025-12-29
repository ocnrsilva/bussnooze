
import { GoogleGenAI } from "@google/genai";

export const getTravelTips = async (destinationName: string) => {
  try {
    // FIX: Initialize GoogleGenAI instance right before making an API call to ensure it uses the current context's API key.
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `The user is traveling to "${destinationName}" and wants to sleep on the bus. 
      Provide 3 extremely brief, punchy safety/travel tips for someone napping on public transport. 
      Keep it under 60 words total. Format as a simple list.`,
    });
    return response.text;
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Keep your belongings close. Stay alert when the alarm sounds. Safe travels!";
  }
};
