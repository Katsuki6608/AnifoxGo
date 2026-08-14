/* AnimeToonSekai — AniList data engine (metadata only, NO player, NO stream links).
 * Loads all anime data from the AniList public GraphQL API on the client.
 * Config is injected from PHP via wp_localize_script as window.ATS_CONFIG.
 */
(function () {
  'use strict';

  var CFG = window.ATS_CONFIG || {};
  var API = CFG.anilistUrl || 'https://graphql.anilist.co';
  var HOME = CFG.homeUrl || '/';
  var PER = CFG.perPage || 24;

  /* ---------- small helpers ---------- */
  function el(id) { return document.getElementById(id); }
  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function stripHtml(s) { var d = document.createElement('div'); d.innerHTML = s || ''; return d.textContent || d.innerText || ''; }
  function title(a) { return (a.title && (a.title.english || a.title.romaji || a.title.native)) || 'Untitled'; }
  function score(a) { return a.averageScore ? (a.averageScore / 10).toFixed(1) : (a.meanScore ? (a.meanScore / 10).toFixed(1) : '—'); }
  var WATCH_MAP = CFG.watchMap || {};
  function watchUrl(id) { return WATCH_MAP[id] || null; }
  // Prefer the real watch page if this AniList id has an Anime post; else the info page.
  function detailUrl(id) { return watchUrl(id) || (HOME + '?ats_anime=' + encodeURIComponent(id)); }
  function listUrl(v) { return HOME + '?ats=' + encodeURIComponent(v); }
  function fmtType(a) { return (a.format || a.type || 'TV').replace('_', ' '); }

  /* ---------- AniList GraphQL fetch ---------- */
  function gql(query, variables) {
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query: query, variables: variables || {} })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.errors) throw new Error(j.errors[0] && j.errors[0].message);
      return j.data;
    });
  }

  var MEDIA_FIELDS =
    'id title{romaji english native} coverImage{large extraLarge color} bannerImage ' +
    'averageScore meanScore episodes duration status format seasonYear season genres ' +
    'nextAiringEpisode{episode} ' +
    'description(asHtml:false) studios(isMain:true){nodes{name}} startDate{year month day} ' +
    'endDate{year} source popularity favourites';

  function pageQuery(sort) {
    return 'query($page:Int,$perPage:Int){Page(page:$page,perPage:$perPage){' +
      'pageInfo{currentPage hasNextPage} ' +
      'media(type:ANIME,sort:' + sort + ',isAdult:false){' + MEDIA_FIELDS + '}}}';
  }

  /* ---------- card renderer (no play button, links to detail page) ---------- */
  function cardHtml(a) {
    var cover = (a.coverImage && (a.coverImage.extraLarge || a.coverImage.large)) || '';
    var st = (a.status || '').replace('_', ' ');
    var stColor = a.status === 'RELEASING' ? 'linear-gradient(135deg,#16a34a,#22c55e)' :
                  a.status === 'NOT_YET_RELEASED' ? 'linear-gradient(135deg,#e8620f,#ff8a2b)' :
                  'linear-gradient(135deg,#475569,#64748b)';
    var stLabel = a.status === 'RELEASING' ? 'Airing' : a.status === 'NOT_YET_RELEASED' ? 'Upcoming' : (a.status === 'FINISHED' ? 'Finished' : st);
    var epNum = a.episodes || (a.nextAiringEpisode && a.nextAiringEpisode.episode ? a.nextAiringEpisode.episode - 1 : 0);
    var dur = a.duration ? (a.duration + 'm') : '';
    // HiAnime bottom-left badges: green CC (sub episode count) + blue Mic (dub count)
    var subBadge = epNum ? '<span class="anime-card-cc"><i class="fas fa-closed-captioning"></i> ' + esc(epNum) + '</span>' : '';
    var dubBadge = epNum ? '<span class="anime-card-dub"><i class="fas fa-microphone"></i> ' + esc(epNum) + '</span>' : '';
    return '' +
      '<a class="anime-card" href="' + detailUrl(a.id) + '">' +
        '<div class="anime-card-imgwrap">' +
          '<span class="anime-card-badge" style="background:' + stColor + '">' + esc(stLabel) + '</span>' +
          '<img class="anime-card-img" loading="lazy" src="' + esc(cover) + '" alt="' + esc(title(a)) + '">' +
          '<div class="anime-card-badges-b">' + subBadge + dubBadge + '</div>' +
          '<div class="anime-card-play"><i class="fas fa-circle-info"></i></div>' +
        '</div>' +
        '<div class="anime-card-body">' +
          '<div class="anime-card-title">' + esc(title(a)) + '</div>' +
          '<div class="anime-card-meta"><span>' + esc(fmtType(a)) + (dur ? ' &bull; ' + esc(dur) : '') + '</span></div>' +
        '</div>' +
      '</a>';
  }

  /* ---------- trending numbered card (big pink number left of poster) ---------- */
  function trendingCardHtml(a, i) {
    var cover = (a.coverImage && (a.coverImage.extraLarge || a.coverImage.large)) || '';
    var n = ('0' + (i + 1)).slice(-2);
    return '' +
      '<a class="trend-card" href="' + detailUrl(a.id) + '">' +
        '<span class="trend-num">' + n + '</span>' +
        '<span class="trend-poster"><img loading="lazy" src="' + esc(cover) + '" alt="' + esc(title(a)) + '"></span>' +
      '</a>';
  }
  function renderTrending(node, list) {
    if (!node) return;
    if (!list || !list.length) { node.innerHTML = '<div class="section-loader">No anime found.</div>'; return; }
    node.innerHTML = list.slice(0, 10).map(trendingCardHtml).join('');
  }

  function renderGrid(node, list) {
    if (!node) return;
    if (!list || !list.length) { node.innerHTML = '<div class="section-loader">No anime found.</div>'; return; }
    node.innerHTML = list.map(cardHtml).join('');
  }

  /* ---------- HERO slider ---------- */
  var heroTimer = null, heroIdx = 0, heroData = [];
  function renderHero(list) {
    var node = el('atsHero'); if (!node) return;
    heroData = list.slice(0, 5);
    node.innerHTML = heroData.map(function (a, i) {
      var bg = a.bannerImage || (a.coverImage && a.coverImage.extraLarge) || '';
      var genres = (a.genres || []).slice(0, 4).map(function (g) {
        return '<a href="' + HOME + '?ats=trending&genre=' + encodeURIComponent(g) + '">' + esc(g) + '</a>';
      }).join('');
      return '<div class="hero-slide' + (i === 0 ? ' active' : '') + '">' +
        '<div class="hero-bg" style="background-image:url(' + esc(bg) + ')"></div>' +
        '<div class="hero-content">' +
          '<span class="hero-badge">#' + (i + 1) + ' Spotlight</span>' +
          '<h1 class="hero-title">' + esc(title(a)) + '</h1>' +
          '<div class="hero-meta">' +
            '<span><i class="fas fa-tv"></i> ' + esc(fmtType(a)) + '</span>' +
            (a.duration ? '<span><i class="far fa-clock"></i> ' + esc(a.duration) + 'm</span>' : '') +
            (a.seasonYear ? '<span><i class="far fa-calendar"></i> ' + esc(a.seasonYear) + '</span>' : '') +
            '<span class="rating"><i class="fas fa-star"></i> ' + esc(score(a)) + '</span>' +
            (a.episodes ? '<span class="hm-pill">' + esc(a.episodes) + '</span>' : '') + '</div>' +
          '<p class="hero-desc">' + esc(stripHtml(a.description).slice(0, 240)) + '</p>' +
          '<div class="hero-actions">' +
            '<a class="btn-primary" href="' + detailUrl(a.id) + '"><i class="fas fa-play"></i> Watch Now</a>' +
            '<a class="btn-ghost" href="' + detailUrl(a.id) + '">Detail <i class="fas fa-chevron-right"></i></a>' +
          '</div>' +
        '</div></div>';
    }).join('') +
      '<div class="hero-dots">' + heroData.map(function (_, i) { return '<button class="hero-dot' + (i === 0 ? ' active' : '') + '" data-i="' + i + '"></button>'; }).join('') + '</div>' +
      '<div class="hero-nav"><button id="atsHeroPrev"><i class="fas fa-chevron-left"></i></button><button id="atsHeroNext"><i class="fas fa-chevron-right"></i></button></div>';

    function show(i) {
      var slides = node.querySelectorAll('.hero-slide'); var dots = node.querySelectorAll('.hero-dot');
      heroIdx = (i + slides.length) % slides.length;
      slides.forEach(function (s, k) { s.classList.toggle('active', k === heroIdx); });
      dots.forEach(function (d, k) { d.classList.toggle('active', k === heroIdx); });
    }
    node.querySelectorAll('.hero-dot').forEach(function (d) { d.addEventListener('click', function () { show(+this.dataset.i); reset(); }); });
    var pv = el('atsHeroPrev'), nx = el('atsHeroNext');
    if (pv) pv.addEventListener('click', function () { show(heroIdx - 1); reset(); });
    if (nx) nx.addEventListener('click', function () { show(heroIdx + 1); reset(); });
    function reset() { if (heroTimer) clearInterval(heroTimer); heroTimer = setInterval(function () { show(heroIdx + 1); }, 6000); }
    reset();
  }

  /* ---------- Top 10 slider ---------- */
  function renderTop10(list) {
    var node = el('atsTop10'); if (!node) return;
    node.innerHTML = list.slice(0, 10).map(function (a, i) {
      var thumb = (a.coverImage && a.coverImage.large) || '';
      var epNum = a.episodes || (a.nextAiringEpisode && a.nextAiringEpisode.episode ? a.nextAiringEpisode.episode - 1 : 0);
      var cc = epNum ? '<span class="t10-cc"><i class="fas fa-closed-captioning"></i> ' + esc(epNum) + '</span>' : '';
      var mic = epNum ? '<span class="t10-dub"><i class="fas fa-microphone"></i> ' + esc(epNum) + '</span>' : '';
      return '<a class="top10-item' + (i < 3 ? ' top10-top' : '') + '" href="' + detailUrl(a.id) + '">' +
        '<span class="top10-rank">' + ('0' + (i + 1)).slice(-2) + '</span>' +
        '<img class="top10-thumb" loading="lazy" src="' + esc(thumb) + '" alt="">' +
        '<span class="top10-info"><span class="top10-name">' + esc(title(a)) + '</span>' +
        '<span class="top10-sub">' + cc + mic + '</span></span>' +
      '</a>';
    }).join('');
  }

  /* ---------- generic horizontal slider arrows ---------- */
  function wireSlider(trackId, prevId, nextId) {
    var track = el(trackId), pv = el(prevId), nx = el(nextId);
    if (!track) return;
    var step = 420;
    if (pv) pv.addEventListener('click', function () { track.scrollBy({ left: -step, behavior: 'smooth' }); });
    if (nx) nx.addEventListener('click', function () { track.scrollBy({ left: step, behavior: 'smooth' }); });
  }

  /* ---------- Genres ---------- */
  function renderGenres(genres) {
    var chips = genres.map(function (g) {
      return '<a class="genre-chip" href="' + HOME + '?ats=trending&genre=' + encodeURIComponent(g) + '">' + esc(g) + '</a>';
    }).join('');
    var node = el('atsGenres'); if (node) node.innerHTML = chips;
    var dnode = el('atsDrawerGenres');
    if (dnode) dnode.innerHTML = genres.map(function (g) { return '<a href="' + HOME + '?ats=trending&genre=' + encodeURIComponent(g) + '">' + esc(g) + '</a>'; }).join('');
  }
  function loadGenres() {
    gql('{GenreCollection}').then(function (d) {
      var g = (d.GenreCollection || []).filter(function (x) { return x && x.toLowerCase() !== 'hentai'; });
      renderGenres(g.slice(0, 14));
    }).catch(function () {
      renderGenres(['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller', 'Mystery']);
    });
  }

  /* ---------- DETAIL page (metadata only) ---------- */
  function renderDetail(a) {
    var node = el('atsDetail'); if (!node) return;
    var cover = (a.coverImage && (a.coverImage.extraLarge || a.coverImage.large)) || '';
    var banner = a.bannerImage || cover;
    var studio = (a.studios && a.studios.nodes && a.studios.nodes[0]) ? a.studios.nodes[0].name : '—';
    var start = a.startDate && a.startDate.year ? [a.startDate.year, a.startDate.month, a.startDate.day].filter(Boolean).join('-') : '—';
    var status = (a.status || '').replace('_', ' ');
    var genres = (a.genres || []).map(function (g) { return '<a class="genre-chip" href="' + HOME + '?ats=trending&genre=' + encodeURIComponent(g) + '">' + esc(g) + '</a>'; }).join('');
    document.title = title(a) + ' — ' + (CFG.siteName || 'AnimeToonSekai');
    node.innerHTML =
      '<div class="detail-main">' +
        '<div class="breadcrumb"><a href="' + HOME + '">Home</a> <i class="fas fa-chevron-right" style="font-size:9px"></i> <span>' + esc(title(a)) + '</span></div>' +
        '<div class="detail-banner"><img src="' + esc(banner) + '" alt=""></div>' +
        '<div class="detail-head"><h1>' + esc(title(a)) + '</h1>' +
          (a.title && a.title.native ? '<div class="native">' + esc(a.title.native) + '</div>' : '') +
          '<div class="detail-meta">' +
            '<span class="rating"><i class="fas fa-star"></i> ' + esc(score(a)) + '</span>' +
            '<span>' + esc(fmtType(a)) + '</span>' +
            (a.episodes ? '<span><i class="fas fa-list-ol"></i> ' + esc(a.episodes) + ' episodes</span>' : '') +
            (a.seasonYear ? '<span><i class="fas fa-calendar"></i> ' + esc(a.seasonYear) + '</span>' : '') +
            '<span><i class="fas fa-signal"></i> ' + esc(status) + '</span>' +
          '</div>' +
          '<div class="detail-genres">' + genres + '</div>' +
          (watchUrl(a.id) ? '<div class="hero-actions" style="margin-top:10px"><a class="btn-primary" href="' + watchUrl(a.id) + '"><i class="fas fa-play"></i> Watch Now</a></div>' : '') +
        '</div>' +
        '<div class="synopsis"><h2>Synopsis</h2>' + (a.descriptionHtml || a.description ? (a.descriptionHtml || a.description) : '<p>No synopsis available.</p>') + '</div>' +
      '</div>' +
      '<aside class="info-card">' +
        '<div class="sidebar-card">' +
          '<div class="poster"><img src="' + esc(cover) + '" alt="' + esc(title(a)) + '"></div>' +
          '<table class="info-table"><tbody>' +
            '<tr><td>English</td><td>' + esc((a.title && a.title.english) || '—') + '</td></tr>' +
            '<tr><td>Romaji</td><td>' + esc((a.title && a.title.romaji) || '—') + '</td></tr>' +
            '<tr><td>Type</td><td>' + esc(fmtType(a)) + '</td></tr>' +
            '<tr><td>Episodes</td><td>' + esc(a.episodes || '—') + '</td></tr>' +
            '<tr><td>Status</td><td>' + esc(status || '—') + '</td></tr>' +
            '<tr><td>Aired</td><td>' + esc(start) + '</td></tr>' +
            '<tr><td>Season</td><td>' + esc(((a.season || '') + ' ' + (a.seasonYear || '')).trim() || '—') + '</td></tr>' +
            '<tr><td>Studio</td><td>' + esc(studio) + '</td></tr>' +
            '<tr><td>Duration</td><td>' + esc(a.duration ? a.duration + ' min' : '—') + '</td></tr>' +
            '<tr><td>Score</td><td>' + esc(score(a)) + ' / 10</td></tr>' +
            '<tr><td>Source</td><td>' + esc((a.source || '—').replace('_', ' ')) + '</td></tr>' +
          '</tbody></table>' +
        '</div>' +
      '</aside>';
  }
  function loadDetail(id) {
    // MEDIA_FIELDS already includes description(asHtml:false); request HTML description via alias to avoid a field conflict.
    gql('query($id:Int){Media(id:$id,type:ANIME){' + MEDIA_FIELDS + ' descriptionHtml:description(asHtml:true)}}', { id: parseInt(id, 10) })
      .then(function (d) { renderDetail(d.Media); })
      .catch(function () {
        var node = el('atsDetail');
        if (node) node.innerHTML = '<div class="section-loader">Could not load this anime. It may not exist on AniList.</div>';
      });
  }

  /* ---------- LIST page ---------- */
  var listPage = 1, listView = 'trending', listGenre = null;
  function sortFor(v) {
    return v === 'popular' ? 'POPULARITY_DESC' :
           v === 'upcoming' ? 'START_DATE' :
           v === 'movies' ? 'POPULARITY_DESC' : 'TRENDING_DESC';
  }
  function loadList() {
    var node = el('atsListGrid'); if (!node) return;
    node.innerHTML = '<div class="section-loader"><i class="fas fa-spinner fa-spin"></i> Loading…</div>';
    var extra = listView === 'upcoming' ? ',status:NOT_YET_RELEASED' : (listView === 'movies' ? ',format:MOVIE' : '');
    var gArg = listGenre ? ',genre:$genre' : '';
    var q = 'query($page:Int,$perPage:Int' + (listGenre ? ',$genre:String' : '') + '){Page(page:$page,perPage:$perPage){' +
      'pageInfo{currentPage hasNextPage} media(type:ANIME,sort:' + sortFor(listView) + ',isAdult:false' + extra + gArg + '){' + MEDIA_FIELDS + '}}}';
    var vars = { page: listPage, perPage: PER }; if (listGenre) vars.genre = listGenre;
    gql(q, vars).then(function (d) {
      renderGrid(node, d.Page.media);
      var pager = el('atsPager');
      if (pager) {
        pager.innerHTML =
          (listPage > 1 ? '<button data-p="' + (listPage - 1) + '"><i class="fas fa-chevron-left"></i> Prev</button>' : '') +
          '<span>Page ' + listPage + '</span>' +
          (d.Page.pageInfo.hasNextPage ? '<button data-p="' + (listPage + 1) + '">Next <i class="fas fa-chevron-right"></i></button>' : '');
        pager.querySelectorAll('button').forEach(function (b) {
          b.addEventListener('click', function () { listPage = +this.dataset.p; window.scrollTo(0, 0); loadList(); });
        });
      }
    }).catch(function () { node.innerHTML = '<div class="section-loader">Failed to load from AniList.</div>'; });
  }

  /* ---------- Search ---------- */
  function doSearch(term) {
    var box = el('atsSearchResults'); if (!box) return;
    if (!term || term.length < 2) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="section-loader"><i class="fas fa-spinner fa-spin"></i></div>';
    gql('query($s:String){Page(perPage:18){media(search:$s,type:ANIME,isAdult:false){' + MEDIA_FIELDS + '}}}', { s: term })
      .then(function (d) { renderGrid(box, d.Page.media); })
      .catch(function () { box.innerHTML = '<div class="section-loader">Search failed.</div>'; });
  }

  /* ---------- Random ---------- */
  function randomAnime() {
    var p = 1 + Math.floor(Math.random() * 40);
    gql('query($page:Int){Page(page:$page,perPage:1){media(type:ANIME,sort:POPULARITY_DESC,isAdult:false){id}}}', { page: p })
      .then(function (d) { var m = d.Page.media[0]; if (m) location.href = detailUrl(m.id); });
  }

  /* ---------- UI wiring ---------- */
  function wireUI() {
    var ham = el('atsHamburger'), drawer = el('atsDrawer'), backdrop = el('atsDrawerBackdrop');
    function openD() { if (drawer) drawer.classList.add('open'); if (backdrop) backdrop.classList.add('open'); }
    function closeD() { if (drawer) drawer.classList.remove('open'); if (backdrop) backdrop.classList.remove('open'); }
    if (ham) ham.addEventListener('click', openD);
    if (backdrop) backdrop.addEventListener('click', closeD);

    var modal = el('atsSearchModal'), input = el('atsSearchInput');
    function openS() { if (modal) { modal.classList.add('open'); if (input) input.focus(); } }
    function closeS() { if (modal) modal.classList.remove('open'); }
    var navSearch = el('atsNavSearch'), navBtn = el('atsNavSearchBtn'), navInput = el('atsNavSearch') && el('atsNavSearch').querySelector('input');
    if (navBtn) navBtn.addEventListener('click', openS);
    var nsi = el('atsNavSearch') ? el('atsNavSearch').querySelector('input') : null;
    if (nsi) nsi.addEventListener('focus', openS);
    if (modal) modal.addEventListener('click', function (e) { if (e.target === modal) closeS(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeS(); });
    var t; if (input) input.addEventListener('input', function () { clearTimeout(t); var v = this.value; t = setTimeout(function () { doSearch(v); }, 350); });

    var rnd = el('atsRandom'), shuf = el('atsShuffle');
    if (rnd) rnd.addEventListener('click', randomAnime);
    if (shuf) shuf.addEventListener('click', randomAnime);
  }

  /* ---------- boot ---------- */
  function boot() {
    wireUI();
    loadGenres();

    var main = document.querySelector('[data-ats-page]');
    var page = main ? main.getAttribute('data-ats-page') : 'home';

    if (page === 'detail') {
      loadDetail(main.getAttribute('data-ats-id'));
      return;
    }

    if (page === 'list') {
      listView = main.getAttribute('data-ats-view') || 'trending';
      var qs = new URLSearchParams(location.search);
      listGenre = qs.get('genre');
      loadList();
      return;
    }

    // HOME: hero (trending), trending slider, latest (releasing), popular, top10 (scored)
    gql(pageQuery('TRENDING_DESC'), { page: 1, perPage: 24 })
      .then(function (d) {
        renderHero(d.Page.media);
        renderTrending(el('atsTrendGrid'), d.Page.media);
        renderGrid(el('atsLatestGrid'), d.Page.media.slice(0, 12));
        wireSlider('atsTrendGrid', 'atsTrendPrev', 'atsTrendNext');
      })
      .catch(function () { var h = el('atsHero'); if (h) h.innerHTML = '<div class="section-loader">Could not reach AniList.</div>'; });

    gql(pageQuery('POPULARITY_DESC'), { page: 1, perPage: 12 })
      .then(function (d) { renderGrid(el('atsPopularGrid'), d.Page.media); })
      .catch(function () {});

    gql(pageQuery('SCORE_DESC'), { page: 1, perPage: 10 })
      .then(function (d) { renderTop10(d.Page.media); wireSlider('atsTop10', 'atsTop10Prev', 'atsTop10Next'); })
      .catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
