import { GoogleGenAI } from '@google/genai';

// Initialize the Gemini SDK
// It automatically picks up GEMINI_API_KEY from environment variables
export const ai = new GoogleGenAI({});
