import { GoogleGenAI, Type } from '@google/genai';
import type { Boq, BoqItem, ProductDetails, Room, ValidationResult, GroundingSource } from '../types';
import { productDatabase } from '../data/productData';

if (!process.env.API_KEY) {
  throw new Error("API_KEY environment variable is not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const databaseString = JSON.stringify(productDatabase.map(p => ({ brand: p.brand, model: p.model, description: p.description, category: p.category, price: p.price })));


/**
 * Generates a Bill of Quantities (BOQ) based on user requirements.
 */
export const generateBoq = async (answers: Record<string, any>): Promise<Boq> => {
    const model = 'gemini-2.5-pro';

    const requiredSystems = answers.requiredSystems || ['display', 'video_conferencing', 'audio', 'connectivity_control', 'infrastructure', 'acoustics'];
    
    const categoryMap: Record<string, string[]> = {
        display: ["Display"],
        video_conferencing: ["Video Conferencing & Cameras"],
        audio: ["Audio - Microphones", "Audio - DSP & Amplification", "Audio - Speakers"],
        connectivity_control: ["Video Distribution & Switching", "Control System & Environmental"],
        infrastructure: ["Cabling & Infrastructure", "Mounts & Racks"],
        acoustics: ["Acoustic Treatment"],
    };

    const allowedCategories = requiredSystems.flatMap((system: string) => categoryMap[system] || []);
    allowedCategories.push("Accessories & Services"); // Always include this category

    const requirements = Object.entries(answers)
      .map(([key, value]) => {
        if (Array.isArray(value) && value.length > 0) {
          return `${key}: ${value.join(', ')}`;
        }
        if (value) {
            return `${key}: ${value}`;
        }
        return null;
      })
      .filter(Boolean)
      .join('; ');

    const prompt = `You are a world-class, senior AV Systems Designer. Your task is to create a 100% technically flawless, logical, and production-ready Bill of Quantities (BOQ) based on the client's detailed requirements from a comprehensive questionnaire. You must adhere strictly to all AVIXA standards and all rules below.

**Custom Product Database (Prioritize these products):**
A comprehensive list of preferred products is available to you.

**Client Requirements (from questionnaire):** "${requirements}"

**MANDATORY DESIGN RULES:**

0.  **HYBRID DATABASE LOGIC (MOST CRITICAL RULE):**
    *   You MUST give absolute first priority to finding suitable products from the 'Custom Product Database' provided.
    *   For each component needed, you must first search the custom database for a suitable match based on brand, model, or description.
    *   If a suitable product is found in the custom database, you MUST use its exact 'brand' and 'model' in your response and set the 'source' to 'database'. You may also use its 'price' if available.
    *   If, and ONLY IF, you cannot find a suitable product in the custom database for a specific requirement, you may then use your general web knowledge to suggest a current, commercially available product and set the 'source' to 'web'.
    *   When using a product from the database, use its description to inform your choice but create a concise, appropriate 'itemDescription' in the final BOQ.

1.  **SCOPE DEFINITION (CRITICAL):** The client has specified which systems are required via the 'requiredSystems' answer. You MUST ONLY include items from the following categories: ${allowedCategories.join(', ')}. Do not generate any items for categories that are not on this allowed list. This is the second most important rule; ignoring it will result in a failed design.

2.  **Core Design Principles:**
    *   **Production-Ready:** Every item must be essential. The final BOQ must represent a complete, installable system with no missing parts *for the requested scope*.
    *   **Logical Cohesion:** The system must be designed as a single, unified ecosystem. Core components for control, audio DSP, and video distribution must be from the same brand family (e.g., Crestron control with Crestron switching; Q-SYS DSP with Q-SYS cameras). Do not mix competing core ecosystems. This is a critical failure condition.
    *   **No Redundancy:** Avoid duplicative functionality. If a Yealink VC kit includes wireless presentation, DO NOT add a separate Barco ClickShare.
    *   **Current Products:** Specify only current-generation, commercially available products. Do not use end-of-life, outdated, or consumer-grade models. All displays MUST be professional/commercial grade.

3.  **Sizing & Coverage (AVIXA Standards):**
    *   **Display Sizing (AVIXA 4:6:8 Rule):** If displays are in scope, calculate the minimum required display height based on the room length. Assume the furthest viewer is at the back of the room. For Boardrooms, NOCs, or Experience Centers, use "Critical Viewing" (furthest viewer <= 4x image height). For all other rooms, use "Detailed Viewing" (furthest viewer <= 6x image height). Select a standard commercial display size (e.g., 55", 65", 75", 86", 98") that meets or exceeds this calculated height.
    *   **Display Brightness (AVIXA ISCR):** If displays are in scope, consider \`naturalLightLevel\`. If 'high', you MUST specify high-brightness displays (min 700 nits) or a high-lumen projector with an Ambient Light Rejecting (ALR) screen.
    *   **Audio Coverage:** If audio is in scope, ensure even sound pressure level (SPL) and high speech intelligibility across the entire seating area. For rooms longer than 15 feet or with more than 8 people, you MUST specify a sufficient number of ceiling speakers.
    *   **Microphone Coverage:** If audio is in scope, ensure complete audio capture for all participants. For any room with a capacity over 6, ceiling or tabletop microphones are mandatory.
    *   **Camera Field of View (FOV):** If video conferencing is in scope, the selected camera(s) MUST capture all participants based on the seating arrangement and room dimensions.

4.  **Brand Preference:** The client has specified preferred brands for certain categories. You MUST prioritize using products from these brands if they are technically suitable and available in the provided database.

5.  **BOQ Structure & Formatting:**
    *   You MUST use and order these categories exactly: 1. Display, 2. Video Conferencing & Cameras, 3. Video Distribution & Switching, 4. Audio - Microphones, 5. Audio - DSP & Amplification, 6. Audio - Speakers, 7. Control System & Environmental, 8. Acoustic Treatment, 9. Cabling & Infrastructure, 10. Mounts & Racks, 11. Accessories & Services.
    *   Group all items correctly under their respective categories. Only use categories from the allowed list in Rule #1.

**OUTPUT FORMAT:**
Return ONLY a valid JSON array of objects with the following properties:
- category: string (Must be one from the allowed list in Rule #1)
- itemDescription: string
- brand: string
- model: string
- quantity: number
- unitPrice: number (Use price from Custom Database if available, otherwise estimate a realistic price in USD)
- totalPrice: number (calculated as quantity * unitPrice)
- source: string ('database' or 'web')
    `;

    const responseSchema = {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            category: { type: Type.STRING },
            itemDescription: { type: Type.STRING },
            brand: { type: Type.STRING },
            model: { type: Type.STRING },
            quantity: { type: Type.NUMBER },
            unitPrice: { type: Type.NUMBER },
            totalPrice: { type: Type.NUMBER },
            source: { type: Type.STRING, enum: ['database', 'web'] },
          },
          required: ['category', 'itemDescription', 'brand', 'model', 'quantity', 'unitPrice', 'totalPrice', 'source'],
        },
    };

    try {
        const response = await ai.models.generateContent({
            model: model,
            contents: [{ 
                role: 'user', 
                parts: [
                    { text: prompt },
                    { text: `Custom Product Database: ${databaseString}` }
                ]
            }],
            config: {
                responseMimeType: "application/json",
                responseSchema: responseSchema,
                temperature: 0.1,
            },
        });

        const jsonText = response.text.trim();
        const boq: BoqItem[] = JSON.parse(jsonText);
        
        const categoryOrder = [
            "Display", "Video Conferencing & Cameras", "Video Distribution & Switching", "Audio - Microphones", "Audio - DSP & Amplification",
            "Audio - Speakers", "Control System & Environmental", "Acoustic Treatment", "Cabling & Infrastructure", "Mounts & Racks", "Accessories & Services",
        ];

        const sortedBoq = boq.sort((a, b) => {
            const indexA = categoryOrder.indexOf(a.category);
            const indexB = categoryOrder.indexOf(b.category);
            return (indexA === -1 ? Infinity : indexA) - (indexB === -1 ? Infinity : indexB);
        });

        return sortedBoq.map((item: BoqItem) => ({
            ...item,
            totalPrice: item.quantity * item.unitPrice
        }));

    } catch (error) {
        console.error('Error generating BOQ:', error);
        throw error;
    }
};

/**
 * Refines an existing BOQ based on a user-provided prompt.
 */
export const refineBoq = async (currentBoq: Boq, refinementPrompt: string): Promise<Boq> => {
    const model = 'gemini-2.5-pro';
    const prompt = `Refine the following Bill of Quantities (BOQ) based on the user's request, ensuring the final design remains technically sound and cohesive. You have access to a custom product database which should be your primary source for new items.

    Current BOQ (in JSON format):
    ${JSON.stringify(currentBoq, null, 2)}

    User's Refinement Request: "${refinementPrompt}"

    Instructions:
    1.  Analyze the user's request and modify the BOQ. This could involve adding, removing, or updating items.
    2.  **CRITICAL:** When adding or changing items, you MUST first search the 'Custom Product Database' provided. Use items from this database whenever possible and set their 'source' to 'database'.
    3.  If no suitable item is in the database, you may use your general knowledge and set the 'source' to 'web'.
    4.  If you add an item from the custom database, use its 'price' if available. Otherwise, estimate a realistic USD price.
    5.  Maintain the integrity of the core system architecture. Do not introduce components that conflict with the established ecosystem.
    6.  Recalculate 'totalPrice' for any items where 'quantity' or 'unitPrice' is changed.
    7.  Return the *complete, updated BOQ* as a single JSON array, identical in format to the input, including the 'source' field for all items.
    
    CRITICAL: The final output must only be the JSON array for the refined BOQ.
    `;
    
    const responseSchema = {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            category: { type: Type.STRING },
            itemDescription: { type: Type.STRING },
            brand: { type: Type.STRING },
            model: { type: Type.STRING },
            quantity: { type: Type.NUMBER },
            unitPrice: { type: Type.NUMBER },
            totalPrice: { type: Type.NUMBER },
            source: { type: Type.STRING, enum: ['database', 'web'] },
          },
          required: ['category', 'itemDescription', 'brand', 'model', 'quantity', 'unitPrice', 'totalPrice', 'source'],
        },
    };

    try {
        const response = await ai.models.generateContent({
            model: model,
            contents: [{ 
                role: 'user', 
                parts: [
                    { text: prompt },
                    { text: `Custom Product Database: ${databaseString}` }
                ]
            }],
            config: {
                responseMimeType: "application/json",
                responseSchema: responseSchema,
            },
        });

        const jsonText = response.text.trim();
        const boq = JSON.parse(jsonText);
        
        return boq.map((item: BoqItem) => ({
            ...item,
            totalPrice: item.quantity * item.unitPrice
        }));
    } catch (error) {
        console.error('Error refining BOQ:', error);
        throw error;
    }
};

/**
 * Generates a photorealistic visualization of a room based on requirements and BOQ.
 */
export const generateRoomVisualization = async (answers: Record<string, any>, boq: Boq): Promise<string> => {
    const model = 'imagen-4.0-generate-001';

    // Create a concise summary of key, visible components
    const coreComponents = boq.filter(item => 
        ['Display', 'Video Conferencing & Cameras', 'Audio - Speakers', 'Control System & Environmental'].includes(item.category)
    );
    const equipmentManifest = coreComponents.map(item => `- ${item.quantity}x ${item.itemDescription} (${item.brand})`).join('\n');

    const prompt = `
      Create a photorealistic, high-quality architectural rendering of a modern corporate ${answers.roomType || 'meeting room'}.
      Room Style: Clean, professional, well-lit.
      Seating: ${answers.seatingArrangement || 'conference table'}.
      Key Technology to feature:
      ${equipmentManifest}
      Perspective: Wide-angle, showing the main display wall and table.
      Final Image: Must be 16:9 landscape. Do NOT add any text, logos, or labels.
    `;

    try {
        const response = await ai.models.generateImages({
            model: model,
            prompt: prompt,
            config: {
              numberOfImages: 1,
              outputMimeType: 'image/jpeg',
              aspectRatio: '16:9',
            },
        });

        if (response.generatedImages && response.generatedImages.length > 0) {
            const base64ImageBytes = response.generatedImages[0].image.imageBytes;
            return `data:image/jpeg;base64,${base64ImageBytes}`;
        } else {
            throw new Error("No image was generated by the API.");
        }
    } catch (error) {
        console.error('Error generating room visualization:', error);
        throw error;
    }
};

/**
 * Validates a BOQ against requirements and best practices.
 */
export const validateBoq = async (boq: Boq, requirements: string): Promise<ValidationResult> => {
    const model = 'gemini-2.5-pro';
    const prompt = `You are an expert AV system design auditor. Analyze the provided Bill of Quantities (BOQ) against the user's requirements with extreme scrutiny. Your primary goal is to identify critical design flaws.

    User Requirements: "${requirements}"

    Current BOQ (JSON):
    ${JSON.stringify(boq, null, 2)}

    Perform the following analysis:
    1.  **Ecosystem Conflict Check (HIGHEST PRIORITY):** Does the BOQ mix core control, audio, and video components from competing ecosystems (e.g., a Crestron control processor with Q-SYS video distribution, or an Extron controller with AMX touch panels)? This is a critical design failure. Flag any such conflicts as a major warning.
    2.  **Completeness Check:** Are there any crucial components missing for a fully functional system? (e.g., mounts for displays, a managed network switch for an AV-over-IP system, power distribution units, a control processor if a touch panel is listed).
    3.  **Networking Check:** If AV-over-IP components are listed, is a specific, brand-name managed network switch also listed? A 'generic' switch is a failure.
    4.  **Environmental Check:** Based on the room type (e.g., Auditorium, Town Hall, Boardroom), have **acoustic treatment** and **specialized lighting** been considered? If they appear to be missing but should be present, list them under 'missingComponents' and add a warning.
    5.  **Compatibility Check:** Are there any less obvious component incompatibilities? Flag any potential mismatches.

    Provide your findings in a structured JSON format. Be strict: if there are any warnings or missing components, 'isValid' MUST be false.
    - isValid: boolean
    - warnings: string[] (List of critical design flaws and incompatibilities).
    - suggestions: string[] (Recommendations for improvement).
    - missingComponents: string[] (Specific components you believe are missing).
    `;

    const responseSchema = {
        type: Type.OBJECT,
        properties: {
            isValid: { type: Type.BOOLEAN },
            warnings: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
            },
            suggestions: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
            },
            missingComponents: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
            },
        },
        required: ['isValid', 'warnings', 'suggestions', 'missingComponents'],
    };

    try {
        const response = await ai.models.generateContent({
            model: model,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: responseSchema,
            },
        });

        const jsonText = response.text.trim();
        return JSON.parse(jsonText);

    } catch (error) {
        console.error('Error validating BOQ:', error);
        return {
            isValid: false,
            warnings: ['AI validation failed to run. Please check the BOQ manually.'],
            suggestions: [],
            missingComponents: [],
        };
    }
};

/**
 * Generates a technical schematic diagram for a room based on requirements and BOQ.
 */
export const generateRoomSchematic = async (answers: Record<string, any>, boq: Boq): Promise<string> => {
    const model = 'imagen-4.0-generate-001';

    // Create a concise summary of key components for the schematic
    const coreComponents = boq.filter(item => 
      !['Cabling & Infrastructure', 'Mounts & Racks', 'Acoustic Treatment', 'Accessories & Services'].includes(item.category)
    );
    const equipmentManifest = coreComponents.map(item => `- ${item.quantity}x ${item.brand} ${item.model}`).join('\n');
    
    const prompt = `
      TASK: Create a professional AV system schematic diagram (functional block diagram).

      STYLE:
      - 2D technical drawing.
      - Black and white line art on a clean white background.
      - Minimalist, clear, and organized.
      - Use standard rectangular blocks for equipment.
      - Label each block with its model name (e.g., "Crestron CP4N", "Shure MXA920"). Text must be legible.
      - Use clear, straight lines with arrows to show logical signal flow.
      - DO NOT add color, shading, or isometric perspectives.

      SYSTEM CONTEXT:
      - This is for a corporate ${answers.roomType || 'meeting room'}.
      
      EQUIPMENT LIST (Must be included and connected logically):
      ${equipmentManifest}
    `;

    try {
        const response = await ai.models.generateImages({
            model: model,
            prompt: prompt,
            config: {
              numberOfImages: 1,
              outputMimeType: 'image/jpeg',
              aspectRatio: '16:9',
            },
        });

        if (response.generatedImages && response.generatedImages.length > 0) {
            const base64ImageBytes = response.generatedImages[0].image.imageBytes;
            return `data:image/jpeg;base64,${base64ImageBytes}`;
        } else {
            throw new Error("No image was generated by the API for the schematic.");
        }
    } catch (error) {
        console.error('Error generating room schematic:', error);
        throw error;
    }
};

/**
 * Fetches product details using Google Search grounding.
 */
export const fetchProductDetails = async (productName: string): Promise<ProductDetails> => {
    const model = 'gemini-2.5-flash';
    const prompt = `Give me a one-paragraph technical and functional overview for the product: "${productName}". The description should be suitable for a customer proposal.
    After the description, on a new line, write "IMAGE_URL:" followed by a direct URL to a high-quality, front-facing image of the product if you can find one.
    `;
    try {
        const response = await ai.models.generateContent({
            model: model,
            contents: prompt,
            config: {
                tools: [{ googleSearch: {} }],
            },
        });

        const text = response.text;
        let description = text;
        let imageUrl = '';

        const imageUrlMatch = text.match(/\nIMAGE_URL:\s*(.*)/);
        if (imageUrlMatch && imageUrlMatch[1]) {
            imageUrl = imageUrlMatch[1].trim();
            description = text.substring(0, imageUrlMatch.index).trim();
        }

        const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
        
        const sources: GroundingSource[] = groundingChunks
            ?.filter((chunk): chunk is { web: { uri: string; title: string } } => !!chunk.web)
            .map(chunk => ({ web: chunk.web! })) || [];

        return {
            description,
            imageUrl,
            sources,
        };
    } catch (error) {
        console.error(`Error fetching product details for "${productName}":`, error);
        throw new Error(`Failed to fetch product details for "${productName}".`);
    }
};