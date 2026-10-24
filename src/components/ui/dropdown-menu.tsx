// Accessible Radix composition following shadcn/ui's MIT-licensed menu pattern.
import * as Primitive from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import './dropdown-menu.css';

export const DropdownMenu=Primitive.Root;
export const DropdownMenuTrigger=Primitive.Trigger;
export const DropdownMenuRadioGroup=Primitive.RadioGroup;

export function DropdownMenuItem({className,...props}:ComponentProps<typeof Primitive.Item>){
  return <Primitive.Item className={cn('dropdown-menu-item',className)} {...props}/>;
}
export function DropdownMenuSeparator(props:ComponentProps<typeof Primitive.Separator>){
  return <Primitive.Separator {...props} className={cn('dropdown-menu-separator',props.className)}/>;
}

export function DropdownMenuContent({className,sideOffset=6,collisionPadding=12,...props}:ComponentProps<typeof Primitive.Content>){
  return <Primitive.Portal><Primitive.Content className={cn('dropdown-menu-content',className)} sideOffset={sideOffset} collisionPadding={collisionPadding} {...props}/></Primitive.Portal>;
}

export function DropdownMenuLabel({className,...props}:ComponentProps<typeof Primitive.Label>){
  return <Primitive.Label className={cn('dropdown-menu-label',className)} {...props}/>;
}

export function DropdownMenuRadioItem({className,children,...props}:ComponentProps<typeof Primitive.RadioItem>){
  return <Primitive.RadioItem className={cn('dropdown-menu-item',className)} {...props}>{children}<span className="dropdown-menu-check"><Primitive.ItemIndicator><Check size={16} aria-hidden="true"/></Primitive.ItemIndicator></span></Primitive.RadioItem>;
}
