'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface AccordionProps {
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * Simple accordion using details/summary with controlled open state for defaultOpen support.
 */
export function Accordion({ title, icon, defaultOpen = false, children, className = '' }: AccordionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`rounded-lg border overflow-hidden ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 p-4 text-left hover:opacity-90 transition-opacity"
      >
        {icon}
        <span className="flex-1 font-semibold text-sm">{title}</span>
        <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t">
          {children}
        </div>
      )}
    </div>
  );
}
