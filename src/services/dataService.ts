import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { Match, Team, Outright } from "../logic/alignment";

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface ExtractedData {
  teams: Team[];
  matches: Match[];
  outrights: Outright[];
}

/**
 * Parses a CSV string into matches and outrights.
 * Expected format helper:
 * Teams: id,name
 * Matches: id,team1Id,team2Id,odds1,oddsX,odds2,lambda1,lambda2,totalLine,overOdds,underOdds
 * Outrights: teamId,odds
 */
export function parseCSV(csv: string): ExtractedData {
  const lines = csv.split('\n').map(l => l.trim()).filter(Boolean);
  const data: ExtractedData = { teams: [], matches: [], outrights: [] };
  
  if (lines.length === 0) return data;

  // Check if it's the new flat format or the old bracketed format
  const isBracketed = lines.some(l => l.startsWith('['));

  if (isBracketed) {
    let section: 'teams' | 'matches' | 'outrights' | null = null;
    const foundTeamIds = new Set<string>();

    for (const line of lines) {
      if (line.toLowerCase() === '[teams]') { section = 'teams'; continue; }
      if (line.toLowerCase() === '[matches]') { section = 'matches'; continue; }
      if (line.toLowerCase() === '[outrights]') { section = 'outrights'; continue; }

      if (!section) continue;

      const parts = line.split(',').map(p => p.trim());
      
      if (section === 'teams' && parts.length >= 2) {
        data.teams.push({ id: parts[0], name: parts[1] });
        foundTeamIds.add(parts[0]);
      } else if (section === 'matches' && parts.length >= 6) {
        const m = {
          id: parts[0],
          team1Id: parts[1],
          team2Id: parts[2],
          odds1: parseFloat(parts[3]) || 0,
          oddsX: parseFloat(parts[4]) || 0,
          odds2: parseFloat(parts[5]) || 0,
          lambda1: parts[6] && parts[6] !== '' ? parseFloat(parts[6]) : undefined,
          lambda2: parts[7] && parts[7] !== '' ? parseFloat(parts[7]) : undefined,
          totalLine: parts[8] && parts[8] !== '' ? parseFloat(parts[8]) : undefined,
          overOdds: parts[9] && parts[9] !== '' ? parseFloat(parts[9]) : undefined,
          underOdds: parts[10] && parts[10] !== '' ? parseFloat(parts[10]) : undefined,
        };
        data.matches.push(m);
        if (!foundTeamIds.has(m.team1Id)) foundTeamIds.add(m.team1Id);
        if (!foundTeamIds.has(m.team2Id)) foundTeamIds.add(m.team2Id);
      } else if (section === 'outrights' && parts.length >= 2) {
        data.outrights.push({
          teamId: parts[0],
          odds: parseFloat(parts[1]) || 0
        });
      }
    }

    // Auto-create teams if missing
    if (data.teams.length === 0 && foundTeamIds.size > 0) {
      foundTeamIds.forEach(id => data.teams.push({ id, name: id }));
    }
  } else {
    // New Flat Format: home, away, 1, X, 2, value, under, over
    const teamNameMap = new Map<string, string>();
    const getTeamId = (name: string) => {
      const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
      if (!teamNameMap.has(slug)) {
        teamNameMap.set(slug, name);
        data.teams.push({ id: slug, name });
      }
      return slug;
    };

    // Skip header if present
    const startIndex = (lines[0].toLowerCase().includes('home') || lines[0].toLowerCase().includes('away')) ? 1 : 0;

    for (let i = startIndex; i < lines.length; i++) {
      // Split by tab or comma
      const parts = lines[i].split(/[,\t]/).map(p => p.trim());
      if (parts.length < 5) continue; // Need at least home, away, 1, X, 2

      const homeName = parts[0];
      const awayName = parts[1];
      const t1Id = getTeamId(homeName);
      const t2Id = getTeamId(awayName);

      data.matches.push({
        id: `m${i}`,
        team1Id: t1Id,
        team2Id: t2Id,
        odds1: parseFloat(parts[2]) || 0,
        oddsX: parseFloat(parts[3]) || 0,
        odds2: parseFloat(parts[4]) || 0,
        totalLine: parts[5] ? parseFloat(parts[5]) : 2.5,
        underOdds: parts[6] ? parseFloat(parts[6]) : undefined,
        overOdds: parts[7] ? parseFloat(parts[7]) : undefined,
      });
    }
  }

  // Ensure every team has an entry in Outrights
  const outrightTeamIds = new Set(data.outrights.map(o => o.teamId));
  data.teams.forEach(t => {
    if (!outrightTeamIds.has(t.id)) {
      data.outrights.push({ teamId: t.id, odds: 0 });
    }
  });

  return data;
}

/**
 * Uses Gemini to extract structured match data from an image.
 */
export async function extractDataFromImage(base64Image: string): Promise<ExtractedData> {
  const prompt = `
    Extract betting odds and team data from this image.
    Identify any sports matches, their team names, and 1X2 odds.
    Also find outright winner odds if present.
    Return data specifically relating to teams, matches (including goals lambdas or totals if available), and outrights.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                data: base64Image.split(',')[1] || base64Image,
                mimeType: "image/png"
              }
            }
          ]
        }
      ],
      config: {
        thinkingConfig: {
          includeThoughts: false,
          thinkingLevel: ThinkingLevel.LOW
        },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            teams: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  name: { type: Type.STRING }
                },
                required: ["id", "name"]
              }
            },
            matches: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  team1Id: { type: Type.STRING },
                  team2Id: { type: Type.STRING },
                  odds1: { type: Type.NUMBER },
                  oddsX: { type: Type.NUMBER },
                  odds2: { type: Type.NUMBER },
                  lambda1: { type: Type.NUMBER },
                  lambda2: { type: Type.NUMBER },
                  totalLine: { type: Type.NUMBER },
                  overOdds: { type: Type.NUMBER },
                  underOdds: { type: Type.NUMBER }
                },
                required: ["id", "team1Id", "team2Id", "odds1", "oddsX", "odds2"]
              }
            },
            outrights: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  teamId: { type: Type.STRING },
                  odds: { type: Type.NUMBER }
                },
                required: ["teamId", "odds"]
              }
            }
          },
          required: ["teams", "matches", "outrights"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No data returned from Gemini");
    return JSON.parse(text);
  } catch (error) {
    console.error("Gemini Extraction Error:", error);
    throw new Error("Failed to extract data from image. Please check the image quality and API key.");
  }
}
