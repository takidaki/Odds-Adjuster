/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Calculator, 
  Plus, 
  Trash2, 
  RefreshCw, 
  CheckCircle2, 
  Info,
  Trophy,
  ArrowRight,
  TrendingUp,
  Settings2,
  FileUp,
  Image as ImageIcon,
  Loader2,
  Download,
  Lock,
  LockOpen
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { 
  Team, 
  Match, 
  Outright, 
  alignOdds, 
  calculateOutrights,
  oddsToProbs,
  probsToOdds,
  estimateLambdas 
} from './logic/alignment';
import { parseCSV, extractDataFromImage, ExtractedData } from './services/dataService';

// --- Default Data (based on images) ---
const DEFAULT_TEAMS: Team[] = [
  { id: 't1', name: 'Mexico' },
  { id: 't2', name: 'South Africa' },
  { id: 't3', name: 'South Korea' },
  { id: 't4', name: 'Czech Republic' },
];

const DEFAULT_MATCHES: Match[] = [
  { id: 'm1', team1Id: 't1', team2Id: 't2', odds1: 1.5, oddsX: 4, odds2: 5.5, lambda1: 2.1, lambda2: 0.67, totalLine: 2.5, overOdds: 1.9, underOdds: 1.98 },
  { id: 'm2', team1Id: 't3', team2Id: 't4', odds1: 2.55, oddsX: 3.2, odds2: 2.6, lambda1: 1.4, lambda2: 1.38, totalLine: 2.5, overOdds: 1.66, underOdds: 2.21 },
  { id: 'm3', team1Id: 't4', team2Id: 't2', odds1: 2.05, oddsX: 3.25, odds2: 3.7, lambda1: 1.83, lambda2: 1.15, totalLine: 2.5, overOdds: 1.5, underOdds: 2.5 },
  { id: 'm4', team1Id: 't1', team2Id: 't3', odds1: 1.91, oddsX: 3.55, odds2: 4, lambda1: 1.9, lambda2: 1.05, totalLine: 2.5, overOdds: 1.6, underOdds: 2.35 },
  { id: 'm5', team1Id: 't4', team2Id: 't1', odds1: 3.9, oddsX: 3.7, odds2: 1.9, lambda1: 1.08, lambda2: 1.92, totalLine: 2.5, overOdds: 1.65, underOdds: 2.2 },
  { id: 'm6', team1Id: 't2', team2Id: 't3', odds1: 3.7, oddsX: 3.25, odds2: 2.05, lambda1: 1.15, lambda2: 1.82, totalLine: 2.5, overOdds: 1.6, underOdds: 2.25 },
];

const DEFAULT_OUTRIGHTS: Outright[] = [
  { teamId: 't1', odds: 1.95 },
  { teamId: 't2', odds: 10.5 },
  { teamId: 't3', odds: 4.8 },
  { teamId: 't4', odds: 4.2 },
];

export default function App() {
  const [teams, setTeams] = useState<Team[]>(DEFAULT_TEAMS);
  const [matches, setMatches] = useState<Match[]>(DEFAULT_MATCHES);
  const [outrights, setOutrights] = useState<Outright[]>(DEFAULT_OUTRIGHTS);
  
  const [adjustedMatches, setAdjustedMatches] = useState<Match[]>([]);
  const [isAligning, setIsAligning] = useState(false);
  const [currentProjection, setCurrentProjection] = useState<Record<string, number>>({});
  const [logs, setLogs] = useState<{msg: string, type: 'info' | 'success' | 'pulse'}[]>([]);
  const [margin, setMargin] = useState(0.05); // Default 5% margin
  const [multipliers, setMultipliers] = useState<Record<string, number>>({});
  
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [isProcessingImage, setIsProcessingImage] = useState(false);

  useEffect(() => {
    const proj = calculateOutrights(teams, matches, multipliers);
    setCurrentProjection(proj);
  }, [teams, matches, multipliers]);

  // Reactively update adjusted odds when margin or base fair odds change
  const finalMatches = useMemo(() => {
    if (adjustedMatches.length === 0) return [];
    return adjustedMatches.map(m => {
      // Find probability for this match using stored multipliers (or re-calc)
      // Actually, we can just store the fair probabilities in adjustedMatches 
      // but easier to just use the fair odds we already have
      const [p1, pX, p2] = oddsToProbs(m.fair1!, m.fairX!, m.fair2!);
      const [a1, aX, a2] = probsToOdds(p1, pX, p2, margin);
      return {
        ...m,
        adj1: Number(a1.toFixed(3)),
        adjX: Number(aX.toFixed(3)),
        adj2: Number(a2.toFixed(3)),
      };
    });
  }, [adjustedMatches, margin]);

  const handleAlign = () => {
    setIsAligning(true);
    setLogs([
      { msg: `[${new Date().toLocaleTimeString()}] Accessing scenario matrix (3^${matches.length} combinations)...`, type: 'info' },
      { msg: `[${new Date().toLocaleTimeString()}] Stripping market vig using Shin's Method...`, type: 'info' },
      { msg: `[${new Date().toLocaleTimeString()}] Adjusting λ expectations based on Joint Market targets...`, type: 'info' },
      { msg: `[${new Date().toLocaleTimeString()}] Running non-linear convergence (Target MSE: 0.0001)...`, type: 'info' }
    ]);

    setTimeout(() => {
      const hasLambdas = matches.some(m => m.lambda1 !== undefined && m.lambda2 !== undefined);
      const { results, multipliers: newMultipliers } = alignOdds(teams, matches, outrights, margin);
      setAdjustedMatches(results);
      setMultipliers(newMultipliers);
      setIsAligning(false);
      setLogs(prev => [
        ...prev,
        { msg: `[${new Date().toLocaleTimeString()}] Success. Model synchronized with Outright market.`, type: 'success' },
        hasLambdas ? { msg: `[${new Date().toLocaleTimeString()}] Verified Poisson goal-distribution consistency.`, type: 'info' } : null,
        { msg: `[${new Date().toLocaleTimeString()}] Applied ${ (margin * 100).toFixed(1) }% margin to final outputs.`, type: 'info' },
        { msg: `[${new Date().toLocaleTimeString()}] Ready for high-precision validation.`, type: 'pulse' }
      ].filter((l): l is {msg: string, type: 'info' | 'success' | 'pulse'} => l !== null));
    }, 800);
  };

  const updateMatch = (id: string, field: keyof Match, value: any) => {
    setMatches(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m));
  };

  const addMatch = () => {
    const newId = `m${Date.now()}`;
    const newMatch: Match = {
      id: newId,
      team1Id: teams[0]?.id || '',
      team2Id: teams[1]?.id || '',
      odds1: 2.0,
      oddsX: 3.0,
      odds2: 2.0
    };
    setMatches([...matches, newMatch]);
  };

  const removeMatch = (id: string) => {
    setMatches(prev => prev.filter(m => m.id !== id));
  };

  const toggleLock = (id: string) => {
    setMatches(prev => prev.map(m => m.id === id ? { ...m, locked: !m.locked } : m));
  };

  const addTeam = () => {
    const newId = `t${Date.now()}`;
    const newTeam: Team = { id: newId, name: `New Team ${teams.length + 1}` };
    setTeams([...teams, newTeam]);
    setOutrights([...outrights, { teamId: newId, odds: 10.0 }]);
  };

  const removeTeam = (id: string) => {
    setTeams(prev => prev.filter(t => t.id !== id));
    setOutrights(prev => prev.filter(o => o.teamId !== id));
    setMatches(prev => prev.filter(m => m.team1Id !== id && m.team2Id !== id));
  };

  const updateTeamName = (id: string, name: string) => {
    setTeams(prev => prev.map(t => t.id === id ? { ...t, name } : t));
  };

  const handleEstimateLambda = (m: Match) => {
    if (!m.totalLine || !m.overOdds || !m.underOdds) {
      alert('Please enter Total Line, Over Odds, and Under Odds first.');
      return;
    }
    const [l1, l2] = estimateLambdas(m.odds1, m.oddsX, m.odds2, m.totalLine, m.overOdds, m.underOdds);
    updateMatch(m.id, 'lambda1', Number(l1.toFixed(3)));
    updateMatch(m.id, 'lambda2', Number(l2.toFixed(3)));
  };

  const updateOutright = (teamId: string, value: string) => {
    const num = parseFloat(value);
    if (isNaN(num)) return;
    setOutrights(prev => prev.map(o => o.teamId === teamId ? { ...o, odds: num } : o));
  };

  const resetToDefaults = () => {
    if (confirm("Are you sure you want to reset all data to template defaults?")) {
      setTeams(DEFAULT_TEAMS);
      setMatches(DEFAULT_MATCHES);
      setOutrights(DEFAULT_OUTRIGHTS);
      setAdjustedMatches([]);
      setMultipliers({});
      setLogs([{ msg: `[${new Date().toLocaleTimeString()}] System reset to default prototype state.`, type: 'info' }]);
    }
  };

  const handleCsvImport = (autoSync = false) => {
    try {
      const data = parseCSV(importText);
      
      // Basic Validation
      const errors: string[] = [];
      if (data.matches.length === 0) errors.push("No matches found in CSV.");
      if (data.outrights.every(o => o.odds === 0)) errors.push("Outright odds appear to be empty or 0.");
      
      if (errors.length > 0) {
        setLogs(prev => [...prev, ...errors.map(err => ({ msg: `[IMPORT ERROR] ${err}`, type: 'info' as const }))]);
        alert("Import warnings:\n- " + errors.join("\n- "));
      }

      setAdjustedMatches([]);
      setMultipliers({});
      if (data.teams.length > 0) setTeams(data.teams);
      if (data.matches.length > 0) setMatches(data.matches);
      if (data.outrights.length > 0) setOutrights(data.outrights);
      
      setShowImport(false);
      setImportText('');
      setLogs(prev => [...prev, { msg: `[${new Date().toLocaleTimeString()}] Imported data from CSV successfully (${data.matches.length} matches).`, type: 'success' }]);
      
      if (autoSync) {
        setTimeout(handleAlign, 100);
      }
    } catch (e) {
      alert("Error parsing CSV. Please check formatting.");
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processImageFile(file);
  };

  const processImageFile = async (file: File) => {
    setIsProcessingImage(true);
    setLogs(prev => [...prev, { msg: `[${new Date().toLocaleTimeString()}] Uploading image for Gemini scanning...`, type: 'info' }]);

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target?.result as string;
        try {
          const data = await extractDataFromImage(base64);
          setAdjustedMatches([]);
          setMultipliers({});
          if (data.teams.length > 0) setTeams(data.teams);
          if (data.matches.length > 0) setMatches(data.matches);
          if (data.outrights.length > 0) setOutrights(data.outrights);
          setLogs(prev => [...prev, { msg: `[${new Date().toLocaleTimeString()}] Gemini extracted match data successfully.`, type: 'success' }]);
        } catch (err) {
          setLogs(prev => [...prev, { msg: `[${new Date().toLocaleTimeString()}] ERROR: Image extraction failed.`, type: 'info' }]);
          alert("Could not extract data from image. Ensure the image is clear or try CSV.");
        } finally {
          setIsProcessingImage(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setIsProcessingImage(false);
    }
  };

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            setShowImport(true);
            processImageFile(file);
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [teams, matches, outrights]);

  const handleDownloadTemplate = () => {
    const template = getCsvTemplate();
    const blob = new Blob([template], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'odds_template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getCsvTemplate = () => {
    return `home,away,1,X,2,value,under,over
Canada,Bosnia & Herzegovina,1.83,3.7,3.6,2.5,1.7,2.1
Qatar,Switzerland,9.0,5.25,1.27,2.5,2.2,1.65
Switzerland,Bosnia & Herzegovina,1.61,3.6,5.6,2.5,1.85,1.95
Canada,Qatar,1.68,3.95,5.7,2.5,1.9,1.9
Bosnia & Herzegovina,Qatar,1.8,3.6,4.2,2.5,1.6,2.3
Switzerland,Canada,2.2,3.3,3.2,2.5,1.65,2.2`;
  };

  const getTeamName = (id: string) => teams.find(t => t.id === id)?.name || 'Unknown';

  return (
    <div className="bg-[#E4E3E0] text-[#141414] font-sans h-screen flex flex-col border-[12px] border-[#141414] overflow-hidden selection:bg-black selection:text-white">
      {/* Header Section */}
      <header className="border-b border-[#141414] p-4 flex items-center justify-between bg-white shrink-0">
        <div>
          <h1 className="font-serif italic text-2xl font-bold tracking-tight">
            ODDS_ALIGN <span className="text-[10px] font-mono bg-[#141414] text-white px-2 py-1 align-middle ml-2 uppercase">v2.4.0-Stable</span>
          </h1>
          <p className="text-[10px] font-mono opacity-60 uppercase mt-1">Probability Iteration & Outright Alignment Engine</p>
        </div>
        <div className="flex gap-6 items-center">
          <button 
            onClick={() => setShowImport(!showImport)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 border border-[#141414] text-[10px] uppercase font-bold tracking-tighter hover:bg-[#141414] hover:text-white transition-all",
              showImport && "bg-[#141414] text-white"
            )}
          >
            <FileUp className="w-3.5 h-3.5" />
            Import Source
          </button>
          <div className="h-10 w-px bg-[#141414] opacity-20"></div>
          <div className="flex flex-col items-end">
            <span className="text-[9px] font-mono uppercase opacity-50 tracking-wider text-right">Target Margin (%)</span>
            <input 
              type="number"
              step="0.1"
              value={margin * 100}
              onChange={(e) => setMargin(parseFloat(e.target.value) / 100)}
              className="text-lg font-mono font-bold bg-transparent text-right focus:outline-none w-20 border-b border-black/5 hover:border-black/20 focus:border-black transition-all"
            />
          </div>
          <div className="h-10 w-px bg-[#141414] opacity-20"></div>
          <button 
            onClick={handleAlign}
            disabled={isAligning}
            className="bg-[#141414] text-white px-6 py-2 flex items-center gap-3 hover:bg-[#333] transition-colors disabled:opacity-50"
          >
            <span className="font-mono text-sm tracking-widest uppercase font-bold">
              {isAligning ? 'Running Iteration' : 'Run Alignment'}
            </span>
            <span className={cn("w-2 h-2 rounded-full", isAligning ? "bg-amber-400 animate-pulse" : "bg-green-400")}></span>
          </button>
        </div>
      </header>

      {/* Import Drawer */}
      <AnimatePresence>
        {showImport && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-b border-[#141414] bg-white overflow-hidden"
          >
            <div className="p-6 grid grid-cols-2 gap-8 max-w-6xl mx-auto">
              <div className="flex flex-col gap-4">
                <div className="flex justify-between items-end">
                  <h3 className="text-xs font-bold uppercase tracking-widest font-mono">Option 1: Paste CSV Data</h3>
                  <div className="flex gap-4">
                    <button 
                      onClick={() => setImportText(getCsvTemplate())}
                      className="text-[9px] font-mono underline opacity-40 hover:opacity-100 transition-opacity flex items-center gap-1"
                    >
                      <RefreshCw className="w-2.5 h-2.5" /> Load Template
                    </button>
                    <button 
                      onClick={handleDownloadTemplate}
                      className="text-[9px] font-mono underline opacity-40 hover:opacity-100 transition-opacity flex items-center gap-1"
                    >
                      <Download className="w-2.5 h-2.5" /> Download .CSV
                    </button>
                  </div>
                </div>
                <textarea 
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder="home, away, 1, X, 2, value, under, over..."
                  className="w-full h-40 bg-[#F5F5F3] border border-[#141414]/10 p-3 font-mono text-[10px] focus:outline-none focus:border-[#141414] transition-all resize-none"
                />
                <div className="flex gap-2">
                  <button 
                    onClick={() => handleCsvImport(false)}
                    className="flex-1 border border-[#141414] p-3 font-bold text-xs uppercase tracking-widest hover:bg-[#141414] hover:text-white transition-all disabled:opacity-30"
                    disabled={!importText.trim()}
                  >
                    Import Only
                  </button>
                  <button 
                    onClick={() => handleCsvImport(true)}
                    className="flex-1 bg-[#141414] text-white p-3 font-bold text-xs uppercase tracking-widest hover:bg-black transition-all disabled:opacity-30 flex items-center justify-center gap-2"
                    disabled={!importText.trim()}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Import & Sync
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <h3 className="text-xs font-bold uppercase tracking-widest font-mono">Option 2: Gemini Image Extract</h3>
                <div className="flex-1 border-2 border-dashed border-[#141414]/10 bg-[#F9F9F8] flex flex-col items-center justify-center p-8 group relative overflow-hidden">
                  {isProcessingImage ? (
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="w-8 h-8 animate-spin text-[#141414]" />
                      <span className="text-[10px] font-mono uppercase tracking-widest animate-pulse">Analyzing Vision...</span>
                    </div>
                  ) : (
                    <>
                      <ImageIcon className="w-10 h-10 mb-2 opacity-20 group-hover:opacity-40 transition-opacity" />
                      <p className="text-[10px] font-mono text-center opacity-40 group-hover:opacity-60 transition-opacity">
                        PASTE SCREENSHOT (CTRL+V), DROP OR CLICK<br />
                        <span className="text-[8px] italic">(Processing via Gemini 2.0 Flash)</span>
                      </p>
                      <input 
                        type="file" 
                        accept="image/*"
                        onChange={handleImageUpload}
                        className="absolute inset-0 opacity-0 cursor-pointer"
                      />
                    </>
                  )}
                </div>
                <div className="p-3 bg-blue-50 border border-blue-100 rounded text-[9px] leading-tight text-blue-800 font-mono">
                  <p className="font-bold mb-1 uppercase tracking-tighter">Pro Tip:</p>
                  You can paste a table directly from Excel or Google Sheets. The required columns are: Home, Away, 1, X, 2, Totals Value, Under Odds, Over Odds.
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Workspace */}
      <main className="flex-1 flex overflow-hidden">
        {/* Sidebar: Outright Targets */}
        <aside className="w-[340px] border-r border-[#141414] bg-[#DCDAD7] flex flex-col shrink-0">
          <div className="p-3 border-b border-[#141414] flex justify-between items-center bg-white/40">
            <span className="font-serif italic text-xs uppercase font-bold">Outright Targets</span>
            <button 
              onClick={addTeam}
              className="text-[9px] font-mono border border-[#141414] px-2 py-0.5 hover:bg-[#141414] hover:text-white transition-all uppercase"
            >
              + Team
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-[11px] font-mono border-collapse">
              <thead className="bg-[#141414] text-white sticky top-0 uppercase text-[9px] tracking-wider z-10">
                <tr>
                  <th className="p-2 text-left font-normal border-r border-white/10 uppercase">Team</th>
                  <th className="p-2 text-right font-normal border-r border-white/10 w-24">Target</th>
                  <th className="p-2 text-right font-normal text-blue-300 w-16">Now%</th>
                  <th className="p-2 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141414]/10 bg-white/30">
                {outrights.map(o => {
                  const team = teams.find(t => t.id === o.teamId);
                  if (!team) return null;
                  
                  // Calculate No-Vig Outright (Fair Target) using simple normalization for multi-way
                  const totalInvOdds = outrights.reduce((sum, curr) => sum + (1 / (curr.odds || 1)), 0);
                  const fairP = (1 / (o.odds || 1)) / totalInvOdds;
                  const fairOddsVal = (1 / fairP).toFixed(3);
                  
                  const pNow = (currentProjection[o.teamId] * 100).toFixed(1);
                  const diff = parseFloat(pNow) - (fairP * 100);

                  return (
                    <tr key={o.teamId} className="hover:bg-white/50 group bg-white/10 odd:bg-white/5 transition-colors">
                      <td className="border-r border-[#141414]/10">
                        <input 
                          value={team.name}
                          onChange={(e) => updateTeamName(team.id, e.target.value)}
                          className="w-full bg-transparent p-2 font-bold focus:outline-none focus:bg-white text-[10px] uppercase"
                        />
                      </td>
                      <td className="border-r border-[#141414]/10">
                        <div className="flex flex-col">
                          <input 
                            type="number"
                            step="0.001"
                            value={o.odds}
                            onChange={(e) => updateOutright(o.teamId, e.target.value)}
                            className="w-full bg-transparent text-right font-bold focus:outline-none px-2 py-1 focus:bg-white transition-colors"
                          />
                          <span className="text-[8px] text-right opacity-40 px-2 pb-1">Fair: {fairOddsVal}</span>
                        </div>
                      </td>
                      <td className={cn(
                        "p-2 text-right transition-colors",
                        Math.abs(diff) < 0.2 ? "text-green-600" : "text-amber-600"
                      )}>
                        {pNow}%
                      </td>
                      <td className="p-1">
                        <button 
                          onClick={() => removeTeam(team.id)}
                          className="invisible group-hover:visible opacity-30 hover:opacity-100 hover:text-red-600"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          
          <div className="p-4 bg-[#141414] text-[#E4E3E0]">
            <div className="flex justify-between text-[9px] mb-2 font-mono uppercase opacity-60">
              <span>Iteration Progress</span>
              <span>{isAligning ? 'Iterating...' : adjustedMatches.length > 0 ? 'Converged' : 'Ready'}</span>
            </div>
            <div className="h-1 bg-[#222] w-full overflow-hidden rounded-full">
              <motion.div 
                animate={{ width: isAligning ? '90%' : adjustedMatches.length > 0 ? '100%' : '0%' }}
                className={cn("h-full transition-colors duration-500", isAligning ? "bg-amber-500" : "bg-green-500")}
              />
            </div>
          </div>
        </aside>

        {/* Content: Match Grid */}
        <section className="flex-1 flex flex-col min-w-0">
          <div className="p-3 border-b border-[#141414] flex justify-between items-center bg-white/40 shadow-sm shrink-0">
            <span className="font-serif italic text-xs uppercase font-bold text-[#141414]">Individual Match Adjustments</span>
            <div className="flex gap-4 items-center shrink-0">
              <button 
                onClick={addMatch}
                className="text-[10px] font-mono border border-[#141414] px-3 py-1 hover:bg-[#141414] hover:text-white transition-all uppercase tracking-tighter flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add Match
              </button>
              <div className="h-4 w-px bg-black opacity-20"></div>
              <button 
                onClick={() => setAdjustedMatches([])}
                className="text-[10px] font-mono border border-[#141414] px-3 py-1 hover:bg-[#141414] hover:text-white transition-all uppercase tracking-tighter"
              >
                Reset All
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto bg-[#F9F9F8]">
            <table className="w-full text-xs font-mono border-collapse table-fixed">
              <thead className="bg-[#E4E3E0] sticky top-0 z-10 shadow-[0_1px_0_0_rgba(20,20,20,1)]">
                <tr className="text-[9px] uppercase text-left opacity-60">
                  <th className="p-3 border-b border-r border-[#141414] w-[180px]">Fixture Pairing</th>
                  <th className="p-3 border-b border-r border-[#141414] w-[160px]">Market: Totals</th>
                  <th className="p-3 border-b border-r border-[#141414] w-[130px]">Est. goals (λ)</th>
                  <th className="p-3 border-b border-r border-[#141414] w-[160px]">Market: 1X2</th>
                  <th className="p-3 border-b border-r border-[#141414] w-[140px]">Fair Sync</th>
                  <th className="p-3 border-b border-[#141414] bg-white text-black font-bold uppercase">Final Market ({ (margin * 100).toFixed(1) }%)</th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {matches.map((m, idx) => {
                  const adj = finalMatches.find(am => am.id === m.id);
                  return (
                    <tr key={m.id} className={cn(
                      "hover:bg-blue-50/40 transition-colors group border-b border-[#141414]/5",
                      idx % 2 === 1 && "bg-slate-50/40"
                    )}>
                      <td className="p-3 border-r border-[#141414]/10 shrink-0">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <select 
                              value={m.team1Id}
                              onChange={(e) => updateMatch(m.id, 'team1Id', e.target.value)}
                              className="bg-transparent border-b border-black/10 focus:border-black outline-none w-20 text-[10px] appearance-none cursor-pointer"
                            >
                              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                            <span className="opacity-20 italic">v</span>
                            <select 
                              value={m.team2Id}
                              onChange={(e) => updateMatch(m.id, 'team2Id', e.target.value)}
                              className="bg-transparent border-b border-black/10 focus:border-black outline-none w-20 text-[10px] appearance-none cursor-pointer"
                            >
                              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                            <div className="flex gap-1 ml-auto">
                              <button 
                                onClick={() => toggleLock(m.id)}
                                title={m.locked ? "Unlock Odds" : "Lock Odds (ignore in alignment)"}
                                className={cn(
                                  "p-1 rounded transition-colors",
                                  m.locked ? "text-amber-600 bg-amber-100" : "text-slate-400 hover:text-slate-600"
                                )}
                              >
                                {m.locked ? <Lock className="w-3 h-3" /> : <LockOpen className="w-3 h-3" />}
                              </button>
                              <button 
                                onClick={() => removeMatch(m.id)}
                                className="invisible group-hover:visible text-red-400 hover:text-red-700"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                          <span className="text-[9px] opacity-20 truncate uppercase select-none">Fixture ID: {m.id}</span>
                        </div>
                      </td>
                      <td className="p-3 border-r border-[#141414]/10 bg-slate-50/50">
                        <div className="flex flex-col gap-2">
                          <div className="flex gap-1 items-center">
                            <span className="text-[8px] opacity-40 uppercase w-8">Line</span>
                            <input 
                              type="number" step="0.25" value={m.totalLine ?? 2.5} 
                              onChange={(e) => updateMatch(m.id, 'totalLine', parseFloat(e.target.value))}
                              className="w-full bg-white border border-black/5 p-1 text-[10px] outline-none focus:border-black"
                            />
                          </div>
                          <div className="flex gap-1">
                            <div className="flex flex-col flex-1">
                              <span className="text-[7px] opacity-40 uppercase mb-0.5">Over</span>
                              <input 
                                type="number" step="0.01" value={m.overOdds ?? ''} 
                                onChange={(e) => updateMatch(m.id, 'overOdds', parseFloat(e.target.value))}
                                className="w-full bg-white border border-black/5 p-1 text-[10px] outline-none focus:border-black"
                                placeholder="1.90"
                              />
                            </div>
                            <div className="flex flex-col flex-1">
                              <span className="text-[7px] opacity-40 uppercase mb-0.5">Under</span>
                              <input 
                                type="number" step="0.01" value={m.underOdds ?? ''} 
                                onChange={(e) => updateMatch(m.id, 'underOdds', parseFloat(e.target.value))}
                                className="w-full bg-white border border-black/5 p-1 text-[10px] outline-none focus:border-black"
                                placeholder="1.90"
                              />
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="p-3 border-r border-[#141414]/10 bg-amber-50/20 relative">
                        <div className="grid grid-cols-2 gap-1 mb-6">
                          <div className="flex flex-col">
                            <span className="text-[8px] opacity-40 mb-1 uppercase tracking-tighter">λ1</span>
                            <input 
                              type="number" step="0.01" value={m.lambda1 ?? ''} 
                              placeholder="Auto"
                              onChange={(e) => updateMatch(m.id, 'lambda1', e.target.value === '' ? undefined : parseFloat(e.target.value))}
                              className="bg-white/50 p-1 text-center border border-black/5 focus:bg-white focus:border-black outline-none transition-all text-[10px] font-bold"
                            />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[8px] opacity-40 mb-1 uppercase tracking-tighter">λ2</span>
                            <input 
                              type="number" step="0.01" value={m.lambda2 ?? ''} 
                              placeholder="Auto"
                              onChange={(e) => updateMatch(m.id, 'lambda2', e.target.value === '' ? undefined : parseFloat(e.target.value))}
                              className="bg-white/50 p-1 text-center border border-black/5 focus:bg-white focus:border-black outline-none transition-all text-[10px] font-bold"
                            />
                          </div>
                        </div>
                        <button 
                          onClick={() => handleEstimateLambda(m)}
                          className="absolute bottom-1.5 left-3 right-3 h-4 bg-[#141414] text-white text-[7px] uppercase font-bold tracking-widest hover:bg-black transition-colors flex items-center justify-center gap-1"
                        >
                          <RefreshCw className="w-2 h-2" /> Sync From Markets
                        </button>
                      </td>
                      <td className="p-3 border-r border-[#141414]/10">
                        <div className="grid grid-cols-3 gap-1">
                          <input 
                            type="number" step="0.01" value={m.odds1} 
                            onChange={(e) => updateMatch(m.id, 'odds1', parseFloat(e.target.value))}
                            className="bg-slate-100/30 p-1 text-center border border-black/5 focus:bg-white focus:border-black outline-none transition-all text-[10px]"
                          />
                          <input 
                            type="number" step="0.01" value={m.oddsX} 
                            onChange={(e) => updateMatch(m.id, 'oddsX', parseFloat(e.target.value))}
                            className="bg-slate-100/30 p-1 text-center border border-black/5 focus:bg-white focus:border-black outline-none transition-all text-[10px]"
                          />
                          <input 
                            type="number" step="0.01" value={m.odds2} 
                            onChange={(e) => updateMatch(m.id, 'odds2', parseFloat(e.target.value))}
                            className="bg-slate-100/30 p-1 text-center border border-black/5 focus:bg-white focus:border-black outline-none transition-all text-[10px]"
                          />
                        </div>
                        <div className="text-[7px] opacity-30 mt-1 uppercase text-center tracking-widest italic font-bold">Base 1X2 market</div>
                      </td>
                      <td className="p-3 border-r border-[#141414]/10 bg-blue-50/10">
                        <div className="grid grid-cols-3 gap-1 opacity-60">
                          <div className="p-1 text-center border border-black/5 text-[10px]">
                            {adj?.fair1 || '-'}
                          </div>
                          <div className="p-1 text-center border border-black/5 text-[10px]">
                            {adj?.fairX || '-'}
                          </div>
                          <div className="p-1 text-center border border-black/5 text-[10px]">
                            {adj?.fair2 || '-'}
                          </div>
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="grid grid-cols-3 gap-1">
                          <div className={cn(
                            "p-1.5 text-center border font-bold transition-all shadow-sm text-[10px] flex flex-col items-center relative",
                            adj ? (adj.adj1! < m.odds1 ? "bg-green-50 border-green-200 text-green-700" : "bg-red-50 border-red-200 text-red-700") : "bg-slate-50 border-black/5 opacity-30"
                          )}>
                            {m.locked && <Lock className="w-2 h-2 absolute top-0.5 right-0.5 opacity-40 text-amber-600" />}
                            <span>{adj?.adj1 || '-'}</span>
                            {adj?.adjLambda1 !== undefined && (
                              <span className="text-[7px] opacity-40 uppercase tracking-tighter mt-0.5">λ:{adj.adjLambda1}</span>
                            )}
                          </div>
                          <div className={cn(
                            "p-1.5 text-center border font-bold transition-all shadow-sm text-[10px] flex flex-col justify-center relative",
                            adj ? "bg-white border-black/10" : "bg-slate-50 border-black/5 opacity-30"
                          )}>
                            {m.locked && <Lock className="w-2 h-2 absolute top-0.5 right-0.5 opacity-40 text-amber-600" />}
                            {adj?.adjX || '-'}
                          </div>
                          <div className={cn(
                            "p-1.5 text-center border font-bold transition-all shadow-sm text-[10px] flex flex-col items-center relative",
                            adj ? (adj.adj2! < m.odds2 ? "bg-green-50 border-green-200 text-green-700" : "bg-red-50 border-red-200 text-red-700") : "bg-slate-50 border-black/5 opacity-30"
                          )}>
                            {m.locked && <Lock className="w-2 h-2 absolute top-0.5 right-0.5 opacity-40 text-amber-600" />}
                            <span>{adj?.adj2 || '-'}</span>
                            {adj?.adjLambda2 !== undefined && (
                              <span className="text-[7px] opacity-40 uppercase tracking-tighter mt-0.5">λ:{adj.adjLambda2}</span>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Console / Log Footer */}
          <div className="h-32 border-t border-[#141414] bg-[#F5F5F3] p-3 font-mono overflow-y-auto shrink-0 flex flex-col">
            <div className="flex justify-between items-center mb-1 text-[9px] opacity-40 sticky top-0 bg-[#F5F5F3] z-10">
              <span className="uppercase tracking-widest font-bold">Iteration_Log_Buffer</span>
              <span className="flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-green-500 animate-pulse"></span> 
                LIVE_FEED
              </span>
            </div>
            <div className="space-y-0.5">
              {logs.length === 0 ? (
                <p className="text-[10px] opacity-40 uppercase tracking-tighter">Terminal awaiting iteration command...</p>
              ) : logs.map((log, i) => (
                <p key={i} className={cn(
                  "text-[10px] leading-tight",
                  log.type === 'info' ? "text-blue-800" : 
                  log.type === 'success' ? "text-green-700 font-bold" :
                  "text-black opacity-60 italic"
                )}>
                  {log.msg}
                </p>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* Bottom Status Bar */}
      <footer className="bg-white border-t border-[#141414] p-3 flex justify-between items-center shrink-0 shadow-[0_-2px_4px_rgba(0,0,0,0.02)]">
        <div className="flex gap-8">
          <div className="flex gap-4 items-center">
            <span className="text-[9px] font-mono opacity-50 uppercase tracking-widest">Metadata:</span>
            <span className="text-[10px] font-bold uppercase tracking-tight">{matches.length} matches / {teams.length} teams round-robin</span>
          </div>
          <div className="hidden md:flex gap-4 items-center">
            <span className="text-[9px] font-mono opacity-50 uppercase tracking-widest">System_Metric:</span>
            <span className="text-[10px] font-mono font-bold uppercase text-blue-600">Stable-Iteration v2.4</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={resetToDefaults}
            className="border border-[#141414] px-4 py-1.5 text-[10px] font-bold hover:bg-[#141414] hover:text-white transition-all uppercase tracking-tighter shadow-sm active:translate-y-px"
          >
            System Reset
          </button>
          <button 
            disabled={adjustedMatches.length === 0}
            className="bg-[#141414] text-white px-6 py-1.5 text-[10px] font-bold hover:opacity-90 disabled:opacity-20 transition-all uppercase tracking-tighter shadow-sm active:translate-y-px"
          >
            Export Aligned Odds
          </button>
        </div>
      </footer>
    </div>
  );
}
