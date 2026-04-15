export interface PromptOption {
  id: string;
  phrase: string;
  label: string;
}

export const promptCatalog: PromptOption[] = [
  { id: 'banana-logic', label: 'Banana logic', phrase: 'Banana logic in the hallway' },
  { id: 'tiny-dinosaur', label: 'Tiny dinosaur', phrase: 'Tiny dinosaur, big opinions' },
  { id: 'moon-toast', label: 'Moon toast', phrase: 'Moon toast for breakfast' },
  { id: 'soggy-crown', label: 'Soggy crown', phrase: 'I wore a soggy crown' },
  { id: 'glitter-robot', label: 'Glitter robot', phrase: 'The glitter robot is awake' },
];
