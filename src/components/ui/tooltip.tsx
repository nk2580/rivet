import type {ReactElement,ReactNode} from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import './tooltip.css';

export const TooltipProvider=TooltipPrimitive.Provider;

export function Tooltip({children,content,compact=false}:{children:ReactElement;content:ReactNode;compact?:boolean}){
  return <TooltipPrimitive.Root>
    <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content className={`tooltip-content${compact?' tooltip-compact':''}`} side="bottom" align="end" sideOffset={8} collisionPadding={12} hideWhenDetached>
        {content}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  </TooltipPrimitive.Root>;
}
