// Per-species body-shape templates (T=top M=mid B=belly F=fin E=eye G=glow S=stripe), extruded into voxel fish.
export const FISH_T = {
  slim:  ['.....FF......', 'FF..TTTTTTT..', '.FFTMMMMMMMET', 'FF..BBBBBBBB.', '.....F..F....'],
  perch: ['....F.F.F....', '...FFFFFFF...', 'F..TTTTTTTT..', 'FFTMTMTMTMMET', 'F.MMMMMMMMMMT', 'F..BBBBBBBB..', '.....F..F....'],
  long:  ['......FFF.......', 'F...TTTTTTTTT...', 'FF.TMMMMMMMMMTT.', 'FFTMMMMMMMMMMMET', 'F..BBBBBBBBBBBB.', '.....F....F.....'],
  flat:  ['....TTTT.....', '..TTMMMMTT...', '.TMMMMMMMMT..', 'FTMMMMMMMEET.', 'FTMMMMMMMMMT.', '.TMMMMMMMMT..', '..TTMMMMTT...', '....TTTT.....'],
  tuna:  ['F......FF.......', 'FF...TTTTTTTT...', '.FFTTMMMMMMMMTT.', '..FMMMMMMMMMMMET', '.FFBBBBBBBBBBBB.', 'FF....F.F.F.....', 'F...............'],
  bill:  ['.....FFFFF..........', 'F...TTTTTTTTT.......', 'FF.TMMMMMMMMMTT.....', '.FTMMMMMMMMMMMMETTTT', 'FF.BBBBBBBBBBBB.....', 'F......F............'],
  round: ['.....FF......', '...TTTTTT....', '..TMMMMMMT...', 'F.MMMMMMMMT..', 'FFMMMMMMMMET.', 'F.MMMMMMMMT..', '..BBBBBBBB...', '...BBBBBB....', '.....FF......'],
  squid: ['.......TTTTT..', 'F.F.FMMMMMMMT.', 'FFFFFMMMMMEMMT', 'F.F.FMMMMMMMT.', '.......BBBBB..'],
  glow:  ['....FF......', 'F..TTTTTT...', 'FFTMGMGMMET.', 'F..BGBGBBB..', '....F.......'],
  levi:  ['..........FFFF............', 'F......TTTTTTTTTTT........', 'FF...TTMMMMMMMMMMMTTT.....', '.FF.TMMMMMMMMMMMMMMMMTT...', '..FFMMMMMMMMMMMMMMMMMMMET.', '.FF.BBBBBBBBBBBBBBBBBBBBG.', 'FF....BBBBBBBBBBBBBBB...G.', 'F........F......F......G..'],
  crab:  ['.F.......F.', 'FF.......FF', '.F.TTTTT.F.', '..TMMMMMT..', '.FMMEMEMMF.', 'F.BBBBBBB.F', '.F.F...F.F.'],
  eel:   ['.....FFFFFFFFFF.....', 'FTTTTTTTTTTTTTTTTTT.', '.MMMMMMMMMMMMMMMMMET', '..BBBBBBBBBBBBBBBB..'],
  puffer:['...F.F.F....', '.F.TTTTT.F..', '..TTMMMMTT..', 'FTMMMMMMMET.', '.TMMMMMMMMTT', 'FTMMMMMMMMT.', '.BBBBBBBBB..', 'F.BBBBBBB.F.', '...F.F.F....'],
  angel: ['....F.....', '...FF.....', '..TTT.....', '.TTMMT....', 'FTMMMMET..', 'FMMSMMMMT.', 'FMMSMMMMT.', '.BBSBBBB..', '..BBB.....', '...FF.....', '....F.....'],
  carp:  ['.....FFFF......', 'F...TTTTTTTT...', 'FF.TMMMMMMMMTT.', 'FFTMMMMMMMMMMET', 'FF.BBBBBBBBBBB.', 'F....F...F.....'],
};
