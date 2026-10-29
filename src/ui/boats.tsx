import { BOATS } from '../econ';
import type { BoatId } from '../types';
import type { Fit } from '../models';
import { Canvas, boatPreview } from './parts';

const BOAT_ROLES: Record<BoatId, string> = {
  row: 'Clinker-built dinghy',
  canoe: 'Light cedar canoe',
  skiff: 'Coastal sailing dinghy',
  boatdev: 'Blue-sailed sloop',
  jetski: 'Single-seat sport craft',
  launch: 'Cabin fishing launch',
  trawler: 'Coastal working boat',
  speedboat: 'Twin-outboard runabout',
  catamaran: 'Twin-hull cruiser',
  schooner: 'Two-masted gaff rig',
  cruiser: 'Open-cockpit cruiser',
  drifter: 'Steam-powered fishing boat',
  research: 'Ocean survey vessel',
  flagship: 'Deep-sea stern trawler',
  icebreaker: 'Polar expedition ship',
  yacht: 'Performance sailing yacht',
  motoryacht: 'Flybridge motor yacht',
  superyacht: 'Long-range motor yacht',
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
