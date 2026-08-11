/**
 * ============================================================
 *  MΛLΛK — CONFIG
 * ============================================================
 *  Você NÃO precisa mais editar código para adicionar músicas,
 *  trocar capas ou renomear faixas — tudo isso é feito direto
 *  no site: clique em "+ Nova playlist", "+ Adicionar faixas",
 *  clique na capa para trocar a imagem, e clique no nome de
 *  uma faixa para renomear.
 *
 *  Este arquivo só controla:
 *  1) SITE — nome do artista, tagline e redes sociais.
 *  2) SEED_PLAYLISTS — playlists de exemplo que aparecem na
 *     PRIMEIRA vez que o site abre (só uma vez; depois disso
 *     o navegador guarda tudo que você editar pelo site, e
 *     este arquivo é ignorado). As faixas de exemplo abaixo
 *     não têm áudio nenhum anexado — elas aparecem no site
 *     com um botão "Anexar áudio" para você subir o arquivo
 *     de cada uma pelo navegador.
 * ============================================================
 */

const SITE = {
  platform: "NULLTAPE",
  artist: "MΛLΛK",
  tagline: "prod. & vocals — b4nds y b4nds",
  socials: [
    { label: "Instagram", url: "https://instagram.com/", icon: "instagram" },
    { label: "YouTube",   url: "https://youtube.com/@lttoficial", icon: "youtube" },
    { label: "SoundCloud",url: "https://soundcloud.com/", icon: "soundcloud" },
  ],
};

const SEED_PLAYLISTS = [
  {
    title: "MALAK JUN - SAMPLES | B4NDS Y B4NDS",
    owner: "MALAKSAMPS",
    coverTone: "mono",
    tracks: [
      { title: "MLK - CHICAGO3" },
      { title: "MLK - CHICAGO2" },
      { title: "MLK - CHICAGO" },
      { title: "MALAK - TIPO JHONY DENG 2 deeeser" },
      { title: "MALAK - TIPO JHONY DENG" },
      { title: "MALAK - FREESTYLE GEEK" },
      { title: "MALAK - FARM" },
      { title: "RIVER TYPE BEAT" },
    ],
  },
  {
    title: "MALAK musics previas",
    owner: "MALAKSAMPS",
    coverTone: "amber",
    tracks: [],
  },
];
