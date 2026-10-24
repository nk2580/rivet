import { Info, X } from 'lucide-react';
import { Button } from './ui/button';
import './workspace-toast.css';

export function WorkspaceToast({text,onUndo,onDismiss}:{text:string;onUndo?:()=>void;onDismiss:()=>void}){
  return <div className="workspace-toast-region" aria-label="Workspace notifications">
    <div className="workspace-toast" role="status" aria-atomic="true">
      <Info size={19} className="workspace-toast-icon" aria-hidden="true"/>
      <span className="workspace-toast-message">{text}</span>
      <div className="workspace-toast-actions">
        {onUndo&&<Button variant="ghost" size="sm" onClick={onUndo}>Undo</Button>}
        <Button variant="ghost" size="icon" aria-label="Dismiss notification" onClick={onDismiss}><X size={18} aria-hidden="true"/></Button>
      </div>
    </div>
  </div>;
}
