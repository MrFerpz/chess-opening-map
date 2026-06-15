import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Sunburst, type ColorMode } from './vis/Sunburst';
import { STARTING_FEN, type SerializedNode } from './types';
import './index.css';
let p = 0;
function node(san: string|null, count: number, wins: number, children: SerializedNode[] = []): SerializedNode {
  return { san, ply: p++, fen: STARTING_FEN, count, wins, draws: Math.floor(count*0.1), losses: count-wins-Math.floor(count*0.1), oppRatingSum: 0, oppRatingCount: 0, children };
}
const root = node(null, 1000, 500, [
  node('e4', 600, 360, [ node('e5', 300, 160, [node('Nf3',150,80),node('Bc4',80,50)]), node('c5', 200, 90, [node('Nf3',120,55)]), node('e6',100,40) ]),
  node('d4', 300, 120, [ node('d5', 180, 70, [node('c4',90,40)]), node('Nf6',120,55) ]),
  node('Nf3', 100, 60, [ node('d5', 60, 35) ]),
]);
function App(){ const [m,setM]=useState<ColorMode>('opening');
  return <div style={{maxWidth:420,margin:'0 auto'}}>
    <Sunburst root={root} totalGames={1000} color="white" colorMode={m} onColorModeChange={setM}
      focusPath={[]} onFocusChange={()=>{}} size={400} isMobile visibleRings={2} holeUnits={4} ghostRing engineEnabled={false} />
  </div>; }
createRoot(document.getElementById('root')!).render(<App/>);
