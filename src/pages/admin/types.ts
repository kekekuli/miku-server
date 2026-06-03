export interface PendingAction {
  label: string;
  description: string;
  run: () => void;
}
