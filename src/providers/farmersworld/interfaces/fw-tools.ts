export interface FwTool {
  charged_time: number;
  durability_consumed: number;
  energy_consumed: number;
  img: string;
  level: number;
  mints: string[];
  rarity: string;
  rewards: string[];
  schema_name: 'tools';
  template_id: number;
  template_name: string;
  type: string;
}

export interface AccountFwTool {
  template: FwTool;
  asset_id: string;
  current_durability: number;
  durability: number;
  next_availability: number;
  owner: string;
  template_id: number;
  type: string;
}
