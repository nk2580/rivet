// Accessible Radix composition following shadcn/ui's MIT-licensed Dialog pattern.
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
export const DialogFeedbackContext=createContext<string|null>(null);
export function Dialog({open, onOpenChange, title, description, children, onOpenAutoFocus, onCloseAutoFocus}: {open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; children: ReactNode; onOpenAutoFocus?: (event:Event)=>void; onCloseAutoFocus?: (event:Event)=>void}) {
  const feedback=useContext(DialogFeedbackContext);
  const baseline=useRef(feedback),[visibleFeedback,setVisibleFeedback]=useState<string|null>(null);
  useEffect(()=>{baseline.current=feedback;setVisibleFeedback(null);},[open]);
  useEffect(()=>{if(open&&feedback!==baseline.current)setVisibleFeedback(feedback);},[feedback,open]);
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <DialogPrimitive.Portal><DialogPrimitive.Overlay className="dialog-overlay" />
      <DialogPrimitive.Content className="dialog-content" onOpenAutoFocus={onOpenAutoFocus} onCloseAutoFocus={onCloseAutoFocus}>
        <div className="dialog-heading"><div><DialogPrimitive.Title>{title}</DialogPrimitive.Title><DialogPrimitive.Description>{description}</DialogPrimitive.Description></div><DialogPrimitive.Close className="button button-ghost button-icon" aria-label="Close"><X size={20}/></DialogPrimitive.Close></div>
        {visibleFeedback&&<div className="notice dialog-feedback" role="status">{visibleFeedback}</div>}{children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
