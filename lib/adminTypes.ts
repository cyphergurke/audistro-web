export type CatalogArtist = {
  artist_id: string;
  handle: string;
  display_name: string;
};

export type CatalogBrowseArtistsResponse = {
  artists: CatalogArtist[];
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
