import { Sym } from 'eos-common';

export interface BandwidthInfoResource {
  total: number;
  used: number;
  available: number;
  overdraft: number;
  pricePerUnit: {
    amount: number;
    symbol: Sym;
  };
}

export interface BandwidthInfo {
  ram: Omit<BandwidthInfoResource, 'pricePerUnit'>;
  net: BandwidthInfoResource;
  cpu: BandwidthInfoResource;
}
