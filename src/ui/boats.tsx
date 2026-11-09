import { BOATS } from '../econ';
import type { BoatId } from '../types';
import type { Fit } from '../models';
import { Canvas, boatPreview } from './parts';

const BOAT_ROLES: Record<BoatId, string> = {
  row: 'Clinker-built dinghy',
  skiff: 'Coastal sailing dinghy',
  boatdev: 'Blue-sailed sloop',
  launch: 'Cabin fishing launch',
  trawler: 'Coastal working boat',
  speedboat: 'Twin-outboard runabout',
  catamaran: 'Twin-hull cruiser',
  schooner: 'Two-masted gaff rig',
  drifter: 'Steam-powered fishing boat',
  research: 'Ocean survey vessel',
  flagship: 'Deep-sea stern trawler',
  icebreaker: 'Polar expedition ship',
  yacht: 'Performance sailing yacht',
  motoryacht: 'Flybridge motor yacht',
  superyacht: 'Motor yacht with her own helicopter',
  liner: 'Cruise liner with paying passengers',
  cutter: 'Revenue cutter with a long bow chaser',
  patrol: 'Engine patrol cutter with a boarding team',
  gunboat: 'Engine gunboat with rocket barrages',
  dreadnought: 'Turreted battleship that makes pirates strike',
  missile: 'Missile cruiser with guided missiles',
  destroyer: 'Fast steel destroyer with torpedoes',
  carrier: 'Flat-top with an air wing of jets',
};

export function BoatPortrait({ id, fit }: { id: BoatId; fit: Fit }) {
  const name = BOATS.find(boat => boat.id === id)!.name;
  return (
    <figure class="boat-portrait" data-boat={id}>
      <Canvas cls="preview" draw={boatPreview(id, fit)} role="img" aria-label={`${name}, three-quarter view`} />
      <figcaption class="caps">{BOAT_ROLES[id]}</figcaption>
    </figure>
  );
}
