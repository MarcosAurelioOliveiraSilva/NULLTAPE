# MΛLΛK — Web Player

Player de música estático, no estilo dark industrial / liquid chrome, feito com HTML, CSS e JavaScript puros (sem build, sem dependências além de fontes do Google). Pronto para hospedar no GitHub Pages.

**Tudo é editado direto pelo site — não precisa mexer em código:**
- **Trocar capa:** passe o mouse sobre a capa (na tela de playlists ou dentro de uma playlist) e clique no ícone de lápis.
- **Adicionar músicas:** dentro de uma playlist, clique em **"Adicionar faixas"** e selecione um ou vários arquivos de áudio do seu computador.
- **Renomear uma faixa:** clique no ícone de lápis na linha da faixa (ou dê duplo clique no nome dela), edite o texto e aperte Enter.
- **Criar/renomear/excluir playlist:** o card tracejado "Nova playlist" cria uma nova; dentro da playlist há botões de renomear e excluir.
- **Descrição, tom e BPM de cada faixa:** clique no ícone de "⋯" (três pontinhos) na linha da faixa — abre um painel com um campo de descrição livre, e o **tom** e **BPM detectados automaticamente**.

## Detecção automática de tom e BPM

Assim que você anexa um áudio a uma faixa (seja pelo "Adicionar faixas" ou pelo "Anexar áudio"), o site já roda uma análise automática, 100% no navegador — não sobe nada pra nenhum servidor. Enquanto roda, aparece "Analisando tom & BPM…" embaixo do nome da faixa; quando termina, mostra algo como `128 BPM · Lá menor` no mesmo lugar, e também dentro do painel de "⋯".

Você pode refazer a análise a qualquer momento clicando em **"Refazer análise"** dentro do painel "⋯" da faixa.

> ⚠️ **É uma estimativa, não um valor "oficial".** A detecção usa heurísticas de processamento de sinal (análise de energia pra BPM, análise de cromagrama comparado a perfis tonais pra tom) — funciona bem na maioria das faixas eletrônicas/trap/hip-hop com batida clara, mas pode errar em faixas com tempo muito variável, a cappella, muito ruído/distorção, ou mudanças de andamento no meio da música. Trate como ponto de partida, não como verdade absoluta.

## Estrutura de arquivos

```
malak-player/
├── index.html          → estrutura da página
├── style.css            → todo o visual (tema industrial + tema chrome)
├── app.js                → lógica do player e das edições pelo site
├── db.js                 → salva tudo que você adiciona pelo site (IndexedDB, com reserva em memória)
├── audio-analysis.js     → detecção de tom e BPM (roda no navegador)
├── config.js             → nome do artista, redes sociais e playlists de exemplo
├── .nojekyll              → garante que o GitHub Pages sirva os arquivos corretamente
└── assets/                → pasta livre, não é mais obrigatória (veja abaixo)
```

## ⚠️ Importante: onde as músicas e capas ficam guardadas

Quando você adiciona uma faixa ou troca uma capa **pelo site**, o arquivo é salvo dentro do próprio navegador (tecnologia chamada IndexedDB) — não é enviado para nenhum servidor. Isso significa:

- Funciona offline e sem precisar editar nada.
- **Só aparece no navegador/computador onde você adicionou.** Se você abrir o site em outro celular, computador, ou em uma aba anônima, essas faixas não vão estar lá — só as faixas de exemplo do `config.js`.
- Se você limpar os dados de navegação/cache do navegador, o que foi adicionado pelo site é apagado.
- Não há limite artificial de espaço, mas navegadores costumam liberar algumas centenas de MB a poucos GB, dependendo do dispositivo.

**Se o objetivo é publicar o site no GitHub Pages para o público ouvir as músicas** (não só você, no seu navegador), tem duas opções:

1. **O jeito simples:** publique o site e depois abra ele no SEU navegador (o mesmo onde você vai gerenciar tudo) e adicione as faixas por lá, sempre pelo mesmo navegador/computador. Funciona bem se só você mesmo for tocar/gerenciar.
2. **O jeito "para todo mundo ver":** como o IndexedDB é local por navegador, para que qualquer visitante ouça as mesmas faixas os arquivos de áudio precisam estar hospedados de verdade (no repositório do GitHub, ou em algum storage externo) e referenciados por URL fixa em vez de upload local. Se for esse o seu caso — quer que os visitantes ouçam as faixas sem precisar que você tenha "anexado" nada no navegador deles — me avise que eu adiciono de volta o suporte a apontar faixas para uma URL fixa dentro de `config.js`, funcionando junto com o upload local.

## Rodando localmente

Navegadores bloqueiam `fetch`/áudio em arquivos abertos direto via `file://` em alguns casos. O mais seguro é rodar um servidor local simples:

```bash
cd malak-player
python3 -m http.server 8000
```

Depois abra `http://localhost:8000` em uma **aba normal do navegador** (Chrome, Edge, Firefox etc).

> ⚠️ **Evite abrir pelo painel "Live Preview" do VS Code** (aquela aba interna tipo `127.0.0.1:3000/index.html?vscode-livepreview=true`). Esse preview roda dentro de um iframe restrito que costuma bloquear o IndexedDB — o site ainda funciona, mas as edições feitas pelo site (faixas, capas, nomes) não são salvas ao recarregar. Se o site avisar "Modo sem salvamento", é isso: clique com o botão direito no link e escolha **"Open in Browser"**, ou simplesmente copie a URL (`http://127.0.0.1:8000`) e cole em uma aba normal do Chrome/Edge/Firefox.

## Deploy no GitHub Pages (grátis)

1. Crie um repositório novo no GitHub (ex: `malak-player`).
2. Envie todos os arquivos desta pasta para a raiz do repositório:
   ```bash
   git init
   git add .
   git commit -m "MΛLΛK player"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/malak-player.git
   git push -u origin main
   ```
3. No GitHub, vá em **Settings → Pages**.
4. Em **Source**, selecione a branch `main` e a pasta `/ (root)`.
5. Clique em **Save**. Em ~1 minuto o site estará no ar em:
   `https://SEU_USUARIO.github.io/malak-player/`

## Personalização rápida

- **Tema**: botão no canto superior direito alterna entre "Industrial" (preto) e "Chrome" (invertido). A preferência fica salva no navegador.
- **Redes sociais / nome / tagline**: edite o objeto `SITE` no topo de `config.js`.
- **Cores**: todas as variáveis de cor ficam no topo de `style.css`, em `:root`.

## Atalhos de teclado

- `Espaço` — play/pause
- `Shift + →` — próxima faixa
- `Shift + ←` — faixa anterior
