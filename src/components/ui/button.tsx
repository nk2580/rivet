// Adapted from shadcn/ui's MIT-licensed Button pattern. See THIRD_PARTY_NOTICES.md.
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
const buttonVariants = cva('button', {
  variants: {
    variant: {default: 'button-primary', secondary: 'button-secondary', outline: 'button-outline', ghost: 'button-ghost', destructive: 'button-destructive'},
    size: {default: '', sm: 'button-small', icon: 'button-icon'},
  }, defaultVariants: {variant: 'default', size: 'default'},
});
export function Button({className, variant, size, asChild = false, type = 'button', ...props}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & {asChild?: boolean}) {
  const Component = asChild ? Slot : 'button';
  return <Component data-slot="button" className={cn(buttonVariants({variant, size}), className)} type={asChild ? undefined : type} {...props} />;
}
