import {useState} from 'react';
import type {CharacterPortrait} from '@/domain/portrait';

export function CharacterAvatar({name, portrait, size = 'small'}: {name: string; portrait?: CharacterPortrait | null; size?: 'small' | 'large' | 'preview'}) {
  const [failed, setFailed] = useState('');
  const source = portrait?.dataUrl;
  return <span className={`avatar ${size}`} aria-hidden="true">{source && failed !== source ? <img src={source} alt="" draggable={false} onError={() => setFailed(source)}/> : name.slice(0, 1)}</span>;
}
