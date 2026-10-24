import type { CSSProperties } from 'react';
import { Check } from 'lucide-react';
import { mainColours, type MainColour } from '@/hooks/use-theme';

export function AppearanceSettings({ value, onChange }: { value: MainColour; onChange: (colour: MainColour) => void }) {
  return <section className="settings-section appearance-settings" aria-labelledby="main-colour-heading">
    <h3 id="main-colour-heading">Main colour</h3>
    <p id="main-colour-description">Used for buttons, links, selected items and the Dock icon. Saved on this computer.</p>
    <fieldset className="colour-options" aria-describedby="main-colour-description">
      <legend className="sr-only">Main colour</legend>
      {mainColours.map(colour => <label className="colour-option" key={colour.id}>
        <input type="radio" name="main-colour" value={colour.id} checked={value === colour.id} onChange={() => onChange(colour.id)} />
        <span className="colour-swatch" style={{ '--swatch': colour.swatch } as CSSProperties} aria-hidden="true">
          {value === colour.id && <Check size={15} strokeWidth={3} />}
        </span>
        <span>{colour.name}</span>
      </label>)}
    </fieldset>
  </section>;
}
