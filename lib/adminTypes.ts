export type CatalogArtist = {
  artist_id: string;
  handle: string;
  display_name: string;
};

export type CatalogBrowseArtistsResponse = {
  artists: CatalogArtist[];
};

export type CatalogPayee = {
  payee_id: string;
  artist_id: string;
  fap_public_base_url: string;
  fap_payee_id: string;
};

export type CatalogArtistPayeesResponse = {
  payees: CatalogPayee[];
};

export type CatalogPayeeResponse = {
  payee: {
    payee_id: string;
    artist_id: string;
    fap_public_base_url: string;
    fap_payee_id: string;
  };
};

export type FAPPayeeCreateResponse = {
  payee_id: string;
  display_name: string;
  rail: string;
  mode: string;
  lnbits_base_url: string;
};

export type CatalogIngestUploadResponse = {
  asset_id: string;
  job_id: string;
  status: string;
};

export type CatalogIngestJobResponse = {
  job_id: string;
  asset_id: string;
  status: string;
  error?: string;
};

export type AdminBootstrapArtistResponse = {
  artist_id: string;
  payee_id: string;
  handle: string;
  fap_payee_id: string;
};
