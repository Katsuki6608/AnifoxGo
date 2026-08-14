/* AnimeToonSekai — anime info + watch engine.
 * Handles BOTH views rendered by single-anime.php:
 *   - INFO view  (data-ats-page="info"):  fills meta row / genres / synopsis / sidebar
 *                                         and an episodes grid that links to the watch view.
 *   - WATCH view (data-ats-page="watch"): player + SUB/DUB toggle + episode range tabs +
 *                                         episode grid; loads the chosen embed into an iframe.
 * All episode/server data comes from window.ATS_WATCH (entered by the admin).
 * AniList metadata (poster/score/status/genres/synopsis/next-ep) is auto-fetched if an ID is set.
 */
(function () {
  'use strict';

  var W = window.ATS_WATCH || {};
  var API = W.anilistUrl || 'https://graphql.anilist.co';
  var episodes = Array.isArray(W.episodes) ? W.episodes : [];
  var permalink = W.permalink || (location.pathname);
  // True when the admin added episodes with embed links. When false we build a
  // placeholder episode list from AniList so old anime (no local episodes yet)
  // still render the full info/watch layout instead of a bare page.
  var hasLocalEpisodes = episodes.length > 0;
  var gridInited = false;

  var root = document.querySelector('.ats-anime');
  var PAGE = root ? root.getAttribute('data-ats-page') : 'info';
  var RANGE_SIZE = 100;

  // watch state
  var curType = (root && root.getAttribute('data-ats-type')) === 'dub' ? 'dub' : 'sub';
  var curEp = 0;          // index into episodes[]
  var curRangeStart = 0;  // first episode index of the visible range

  function el(id) { return document.getElementById(id); }
  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function epNum(ep, i) { var n = parseInt(ep && ep.number, 10); return isNaN(n) ? (i + 1) : n; }

  function gql(q, v) {
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify({ query: q, variables: v || {} }) })
      .then(function (r) { return r.json(); }).then(function (j) { if (j.errors) throw 0; return j.data; });
  }

  /* ================= EPISODE GRID (shared) ================= */

  // Filter an episode's servers by the current type (sub/dub). If none of that type
  // exist we fall back to whatever servers the episode has.
  function serversForType(ep, type) {
    var all = (ep && ep.servers) || [];
    var typed = all.filter(function (s) { return (s.type === 'dub' ? 'dub' : 'sub') === type; });
    return typed.length ? typed : all;
  }

  function buildRanges(gridEl, rangesEl, onPick) {
    if (!rangesEl) return;
    if (episodes.length <= RANGE_SIZE) { rangesEl.style.display = 'none'; return; }
    var html = '';
    for (var start = 0; start < episodes.length; start += RANGE_SIZE) {
      var end = Math.min(start + RANGE_SIZE, episodes.length);
      var a = epNum(episodes[start], start);
      var b = epNum(episodes[end - 1], end - 1);
      html += '<button type="button" class="range-btn' + (start === curRangeStart ? ' active' : '') +
        '" data-start="' + start + '">EP ' + a + '-' + b + '</button>';
    }
    rangesEl.innerHTML = html;
    rangesEl.querySelectorAll('.range-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        curRangeStart = +this.dataset.start;
        rangesEl.querySelectorAll('.range-btn').forEach(function (x) { x.classList.remove('active'); });
        this.classList.add('active');
        renderGrid(gridEl, onPick);
      });
    });
  }

  function renderGrid(gridEl, onPick) {
    if (!gridEl) return;
    var asList = gridEl.classList.contains('as-list');
    var end = Math.min(curRangeStart + RANGE_SIZE, episodes.length);
    var html = '';
    for (var i = curRangeStart; i < end; i++) {
      var ep = episodes[i];
      var active = (PAGE === 'watch' && i === curEp) ? ' active' : '';
      var num = epNum(ep, i);
      var t = ep.title || ('Episode ' + num);
      if (asList) {
        // vertical episode list row: number + title (reference watch page)
        html += '<button type="button" class="ep-cell' + active + '" data-i="' + i + '" title="' + esc(t) + '">' +
          '<span class="ep-n">' + esc(num) + '</span><span class="ep-t">' + esc(t) + '</span></button>';
      } else {
        html += '<button type="button" class="ep-cell' + active + '" data-i="' + i + '" title="' + esc(t) + '">' +
          esc(num) + '</button>';
      }
    }
    gridEl.innerHTML = html;
    gridEl.querySelectorAll('.ep-cell').forEach(function (b) {
      b.addEventListener('click', function () { onPick(+this.dataset.i); });
    });
  }

  function gotoEpisode(nInput) {
    var target = parseInt(nInput, 10);
    if (isNaN(target)) return;
    var idx = -1;
    for (var i = 0; i < episodes.length; i++) { if (epNum(episodes[i], i) === target) { idx = i; break; } }
    if (idx < 0) return;
    // jump to watch view for that episode
    location.href = watchUrl(target, curType);
  }

  function watchUrl(num, type) {
    var u = permalink.split('#')[0].split('?')[0];
    return u + '?play=' + encodeURIComponent(num) + '&type=' + (type === 'dub' ? 'dub' : 'sub');
  }

  /* ================= WATCH VIEW ================= */

  function makeIframe(url) {
    var box = el('atsPlayerBox'); if (!box) return;
    if (!url) {
      if (!hasLocalEpisodes) {
        box.innerHTML = '<div class="player-empty"><i class="fas fa-clock"></i><b>This episode isn\'t available yet</b>' +
          '<span>The embed link for this episode hasn\'t been added.</span></div>';
      } else {
        box.innerHTML = '<div class="player-empty"><i class="fas fa-circle-exclamation"></i><b>No ' +
          curType.toUpperCase() + ' server for this episode</b><span>Try switching SUB/DUB.</span></div>';
      }
      return;
    }
    box.innerHTML = '<iframe src="' + esc(url) + '" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="no-referrer" scrolling="no"></iframe>';
  }

  var curServerIdx = 0;

  // Render the HiAnime-style SUB / DUB server pill rows for the current episode.
  function renderServerPills(ep) {
    ['sub', 'dub'].forEach(function (type) {
      var wrap = el(type === 'sub' ? 'atsSubServers' : 'atsDubServers');
      if (!wrap) return;
      var list = (ep && ep.servers || []).filter(function (s) {
        var t = (s.type || 'sub').toLowerCase();
        return type === 'dub' ? t === 'dub' : t !== 'dub';
      });
      if (!list.length) {
        wrap.innerHTML = '<span class="server-pill disabled">N/A</span>';
        return;
      }
      wrap.innerHTML = list.map(function (s, i) {
        var active = (type === curType && i === curServerIdx) ? ' active' : '';
        return '<button type="button" class="server-pill' + active + '" data-type="' + type + '" data-i="' + i + '">' +
          esc(s.name || s.label || ('Server ' + (i + 1))) + '</button>';
      }).join('');
      wrap.querySelectorAll('.server-pill').forEach(function (b) {
        b.addEventListener('click', function () {
          curType = this.dataset.type === 'dub' ? 'dub' : 'sub';
          curServerIdx = parseInt(this.dataset.i, 10) || 0;
          syncTypeToggle();
          playCurrent();
        });
      });
    });
  }

  function syncTypeToggle() {
    var toggle = el('atsTypeToggle');
    if (!toggle) return;
    toggle.querySelectorAll('.type-btn').forEach(function (x) { x.classList.toggle('active', x.dataset.type === curType); });
  }

  function playCurrent() {
    var ep = episodes[curEp]; if (!ep) return;
    var servers = serversForType(ep, curType);
    if (curServerIdx >= servers.length) curServerIdx = 0;
    makeIframe(servers.length ? servers[curServerIdx].url : '');
    renderServerPills(ep);
    var t = el('atsEpTitle');
    if (t) t.innerHTML = '<b>Episode ' + esc(epNum(ep, curEp)) + (ep.title ? ': ' + esc(ep.title) : '') + '</b>' +
      ' <span class="now-type">' + curType.toUpperCase() + '</span>';
    var notice = el('atsNoticeEp');
    if (notice) notice.textContent = 'Episode ' + epNum(ep, curEp);
    // update URL (no reload) so refresh/share keeps the episode
    try { history.replaceState(null, '', watchUrl(epNum(ep, curEp), curType)); } catch (e) {}
  }

  function selectEp(i) {
    if (i < 0 || i >= episodes.length) return;
    curEp = i;
    // move range window to contain i
    curRangeStart = Math.floor(i / RANGE_SIZE) * RANGE_SIZE;
    var gridEl = el('atsEpGrid'), rangesEl = el('atsEpRanges');
    buildRanges(gridEl, rangesEl, selectEp);
    renderGrid(gridEl, selectEp);
    playCurrent();
  }

  function initWatch() {
    // figure out which episode to play from ?play=<num>
    var playNum = parseInt(root.getAttribute('data-ats-play'), 10);
    var startIdx = 0;
    if (!isNaN(playNum)) {
      for (var i = 0; i < episodes.length; i++) { if (epNum(episodes[i], i) === playNum) { startIdx = i; break; } }
    }
    // type toggle
    var toggle = el('atsTypeToggle');
    if (toggle) {
      toggle.querySelectorAll('.type-btn').forEach(function (b) {
        b.classList.toggle('active', b.dataset.type === curType);
        b.addEventListener('click', function () {
          curType = this.dataset.type === 'dub' ? 'dub' : 'sub';
          curServerIdx = 0;
          syncTypeToggle();
          playCurrent();
        });
      });
    }
    // Blue next-episode bar close button
    var neClose = el('atsNextEpClose');
    if (neClose) neClose.addEventListener('click', function () { var b = el('atsNextEpBar'); if (b) b.style.display = 'none'; });
    // "go to ep" search
    var gotoBtn = el('atsEpGotoBtn'), gotoInp = el('atsEpGoto');
    if (gotoBtn && gotoInp) {
      gotoBtn.addEventListener('click', function () { gotoEpisode(gotoInp.value); });
      gotoInp.addEventListener('keydown', function (e) { if (e.key === 'Enter') gotoEpisode(gotoInp.value); });
    }
    // list/grid view toggle (visual only)
    var gv = el('atsEpGridView'), lv = el('atsEpListView'), grid = el('atsEpGrid');
    if (gv && lv && grid) {
      gv.addEventListener('click', function () { grid.classList.remove('as-list'); gv.classList.add('active'); lv.classList.remove('active'); });
      lv.addEventListener('click', function () { grid.classList.add('as-list'); lv.classList.add('active'); gv.classList.remove('active'); });
    }
    selectEp(startIdx);
  }

  /* ================= INFO VIEW ================= */

  function initInfo() {
    var gridEl = el('atsEpGrid'), rangesEl = el('atsEpRanges');
    // On the info page, clicking an episode goes to the watch view.
    function pick(i) { location.href = watchUrl(epNum(episodes[i], i), 'sub'); }
    buildRanges(gridEl, rangesEl, pick);
    renderGrid(gridEl, pick);
  }

  /* ================= AniList metadata (both views) ================= */

  function cleanEpTitle(t) { return t ? String(t).replace(/^\s*Episode\s*\d+\s*[-:]?\s*/i, '').trim() : ''; }

  function applyAniListTitles(stream) {
    if (!Array.isArray(stream) || !stream.length || !episodes.length) return false;
    var byNum = {};
    stream.forEach(function (s, i) { var m = (s.title || '').match(/Episode\s*(\d+)/i); var n = m ? +m[1] : (i + 1); if (!(n in byNum)) byNum[n] = cleanEpTitle(s.title); });
    var changed = false;
    episodes.forEach(function (ep, i) {
      if (!ep.title || !String(ep.title).trim()) { var t = byNum[epNum(ep, i)]; if (t) { ep.title = t; changed = true; } }
    });
    return changed;
  }

  function fmtCountdown(sec) {
    if (!sec || sec < 0) return '';
    var d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600);
    return (d ? d + 'd ' : '') + h + 'h';
  }

  function fillMeta(a) {
    var romaji = a.title && (a.title.romaji || a.title.english) || '';
    var english = a.title && (a.title.english || a.title.romaji) || '';
    var fmt = (a.format || 'TV').replace(/_/g, ' ');
    var status = (a.status || '').replace(/_/g, ' ');
    var score = a.averageScore ? (a.averageScore / 10).toFixed(1) : '—';
    var studioEdges = (a.studios && a.studios.edges) ? a.studios.edges : [];
    var mainStudioList = studioEdges.filter(function (e) { return e.isMain; }).map(function (e) { return e.node.name; });
    var prodList = studioEdges.filter(function (e) { return !e.isMain; }).map(function (e) { return e.node.name; });
    var studios = mainStudioList.length ? mainStudioList : studioEdges.map(function (e) { return e.node.name; });
    var mainStudios = studios.length ? studios.join(', ') : '—';
    var epCount = a.episodes || (a.nextAiringEpisode ? a.nextAiringEpisode.episode - 1 : (episodes.length || '—'));
    var dur = a.duration ? a.duration + 'm' : '—';
    var season = (a.season ? (a.season.charAt(0) + a.season.slice(1).toLowerCase()) : '') + (a.seasonYear ? ' ' + a.seasonYear : '');
    var genres = a.genres || [];
    var cover = a.coverImage && (a.coverImage.extraLarge || a.coverImage.large);
    var statusClass = /RELEASING/i.test(a.status || '') ? 'airing' : (/FINISHED/i.test(a.status || '') ? 'finished' : '');

    // ---- Build placeholder episodes from AniList when none were added locally ----
    // This makes OLD anime (no admin episodes yet) render the full episode grid,
    // range tabs and Watch buttons — identical layout to fully-populated anime.
    if (!hasLocalEpisodes) {
      var alCount = 0;
      if (a.episodes) alCount = a.episodes;
      else if (a.nextAiringEpisode && a.nextAiringEpisode.episode) alCount = a.nextAiringEpisode.episode - 1;
      var stream = Array.isArray(a.streamingEpisodes) ? a.streamingEpisodes : [];
      if (!alCount) alCount = stream.length;
      if (alCount > 0) {
        // map episode number -> cleaned title from streamingEpisodes
        var titleByNum = {};
        stream.forEach(function (s, i) {
          var mm = (s.title || '').match(/Episode\s*(\d+)/i);
          var n = mm ? parseInt(mm[1], 10) : (i + 1);
          if (!(n in titleByNum)) titleByNum[n] = (s.title || '').replace(/^\s*Episode\s*\d+\s*[-:]?\s*/i, '').trim();
        });
        var built = [];
        for (var ei = 0; ei < alCount; ei++) {
          built.push({ number: String(ei + 1), title: titleByNum[ei + 1] || '', servers: [] });
        }
        episodes.length = 0;
        Array.prototype.push.apply(episodes, built);
        // Now that we have episodes, initialize the grid (skipped at boot()).
        if (!gridInited) {
          gridInited = true;
          if (PAGE === 'watch') initWatch(); else initInfo();
        }
      }
    }

    // ---- Landscape banner background (behind Info & Watch pages) ----
    var bannerUrl = a.bannerImage || cover || '';
    if (bannerUrl) {
      var wrap = document.querySelector('.ats-anime');
      if (wrap) {
        wrap.classList.add('has-banner');
        var bg = wrap.querySelector('.ats-banner-bg');
        if (!bg) {
          bg = document.createElement('div');
          bg.className = 'ats-banner-bg';
          wrap.insertBefore(bg, wrap.firstChild);
        }
        bg.style.backgroundImage = 'url("' + bannerUrl.replace(/"/g, '') + '")';
      }
    }

    // ---- INFO view elements ----
    var poster = el('atsPoster');
    if (poster && cover && !poster.querySelector('img')) poster.innerHTML = '<img src="' + esc(cover) + '" alt="">';
    var setTxt = function (id, v) { var e = el(id); if (e) e.textContent = v; };
    setTxt('atsAltTitle', english && english !== document.title ? english : romaji);
    if (el('atsMScore')) el('atsMScore').innerHTML = '<i class="fas fa-star" style="color:#ffd043"></i> ' + score;
    setTxt('atsMStatus', status || '—');
    setTxt('atsMFormat', fmt);
    setTxt('atsMEps', epCount || '—');
    setTxt('atsMDur', dur);
    var g1 = el('atsGenres');
    if (g1) g1.innerHTML = genres.slice(0, 6).map(function (g) { return '<span class="genre-chip">' + esc(g) + '</span>'; }).join('');

    // ---- INFO badges row (R / HD / CC n / mic n / TV / 24m) ----
    var subCount = a.episodes || (a.nextAiringEpisode ? a.nextAiringEpisode.episode - 1 : (episodes.length || '?'));
    if (el('atsBadgeSub')) el('atsBadgeSub').textContent = subCount || '?';
    if (el('atsBadgeDub')) el('atsBadgeDub').textContent = subCount || '?';
    if (el('atsBadgeType')) el('atsBadgeType').textContent = fmt;
    if (el('atsBadgeDur')) el('atsBadgeDur').textContent = dur;
    // poster rating badge: 18+ for adult, else PG
    var pr = el('atsPosterRating');
    if (pr) { if (a.isAdult) { pr.textContent = '18+'; } else { pr.style.display = 'none'; } }

    // ---- right info-detail panel (Japanese / Synonyms / Aired / Premiered / …) ----
    var native = (a.title && a.title.native) || '—';
    var fmtDate = function (d) {
      if (!d || !d.year) return '';
      var mn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return (d.month ? mn[d.month - 1] + ' ' : '') + (d.day ? d.day + ', ' : '') + d.year;
    };
    var aired = fmtDate(a.startDate) + (a.endDate && a.endDate.year ? ' to ' + fmtDate(a.endDate) : (a.startDate && a.startDate.year ? ' to ?' : ''));
    var premiered = season || '—';
    var malScore = a.averageScore ? (a.averageScore / 10).toFixed(2) : '?';
    setTxt('atsInfoJp', native);
    setTxt('atsInfoSyn', (a.synonyms && a.synonyms.length) ? a.synonyms.slice(0, 2).join(', ') : romaji);
    setTxt('atsInfoAired', aired || '—');
    setTxt('atsInfoPrem', premiered);
    setTxt('atsInfoDur', dur);
    setTxt('atsInfoStatus', /RELEASING/i.test(a.status || '') ? 'Currently Airing' : (status || '—'));
    setTxt('atsInfoMal', malScore);
    setTxt('atsInfoStudios', mainStudios);
    setTxt('atsInfoProducers', prodList.length ? prodList.slice(0, 3).join(', ') : '—');

    // ---- More Seasons (from AniList relations: prequels/sequels/side stories) ----
    renderSeasons(a);
    // sidebar rating score (watch view)
    setTxt('atsSideScore', score);

    // synopsis (add heading if body empty)
    var syn = el('atsSynopsis');
    if (syn) {
      if (!syn.textContent.trim() && a.description) syn.innerHTML = a.description;
      // toggle +More if long
      var mt = el('atsMoreToggle');
      if (mt && syn.scrollHeight > 130) {
        syn.classList.add('clamped');
        mt.hidden = false;
        mt.addEventListener('click', function () {
          syn.classList.toggle('clamped');
          mt.textContent = syn.classList.contains('clamped') ? '+ More' : '- Less';
        });
      }
    }

    // ---- Sidebar (shared) ----
    var sThumb = el('atsSideThumb');
    if (sThumb && cover && !sThumb.querySelector('img')) sThumb.innerHTML = '<img src="' + esc(cover) + '" alt="">';
    setTxt('atsSideAlt', romaji && romaji !== english ? romaji : (a.title && a.title.native || ''));
    var badges = el('atsSideBadges');
    if (badges) {
      var b = [];
      if (status) b.push('<span class="ic-badge ' + statusClass + '"><i class="fas fa-circle" style="font-size:7px"></i> ' + esc(status) + '</span>');
      b.push('<span class="ic-badge"><i class="fas fa-tv"></i> ' + esc(fmt) + '</span>');
      if (epCount && epCount !== '—') b.push('<span class="ic-badge"><i class="fas fa-film"></i> ' + esc(epCount) + ' Eps</span>');
      badges.innerHTML = b.join('');
    }
    var sg = el('atsSideGenres');
    if (sg) sg.innerHTML = genres.slice(0, 6).map(function (g) { return '<span class="genre-chip">' + esc(g) + '</span>'; }).join('');
    var sd = el('atsSideDesc');
    if (sd && a.description) { var tmp = document.createElement('div'); tmp.innerHTML = a.description; sd.textContent = (tmp.textContent || '').slice(0, 220) + '…'; }

    var tbody = el('atsInfoTable') && el('atsInfoTable').querySelector('tbody');
    if (tbody) {
      var nextEp = '';
      if (a.nextAiringEpisode) nextEp = 'EP ' + a.nextAiringEpisode.episode + ' in ' + fmtCountdown(a.nextAiringEpisode.timeUntilAiring);
      var rows = [
        ['Studio', mainStudios],
        ['Season', season || '—'],
        ['Aired', a.seasonYear || '—'],
        ['Status', status || '—'],
        ['Type', fmt],
        ['Genres', genres.join(', ') || '—']
      ];
      if (nextEp) rows.push(['Next EP', '<span class="next-ep">' + esc(nextEp) + '</span>']);
      tbody.innerHTML = rows.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + r[1] + '</td></tr>'; }).join('');
    }

    // Blue "estimated next episode" bar (watch view)
    var neBar = el('atsNextEpBar'), neTxt = el('atsNextEpText');
    if (neBar && neTxt && a.nextAiringEpisode && a.nextAiringEpisode.timeUntilAiring) {
      neTxt.textContent = 'Estimated the ' + a.nextAiringEpisode.episode +
        (a.nextAiringEpisode.episode % 10 === 1 ? 'st' : a.nextAiringEpisode.episode % 10 === 2 ? 'nd' : a.nextAiringEpisode.episode % 10 === 3 ? 'rd' : 'th') +
        ' episode will be released in ' + fmtCountdown(a.nextAiringEpisode.timeUntilAiring) + '.';
      neBar.style.display = 'flex';
    }

    // episode titles backfill
    if (applyAniListTitles(a.streamingEpisodes)) {
      if (PAGE === 'watch') playCurrent();
      // refresh grids' tooltips
      var gridEl = el('atsEpGrid'); if (gridEl) renderGrid(gridEl, PAGE === 'watch' ? selectEp : function (i) { location.href = watchUrl(epNum(episodes[i], i), 'sub'); });
    }
  }

  // Render the "More Seasons" / "Watch more seasons" row from AniList relations.
  function renderSeasons(a) {
    var node = el('atsSeasons'); if (!node) return;
    var edges = (a.relations && a.relations.edges) || [];
    var wanted = { PREQUEL: 1, SEQUEL: 1, SIDE_STORY: 1, PARENT: 1, ALTERNATIVE: 1, SPIN_OFF: 1 };
    var items = edges.filter(function (e) {
      return e.node && e.node.type === 'ANIME' && wanted[e.relationType];
    });
    if (!items.length) { node.innerHTML = '<div class="section-loader" style="padding:14px;font-size:12px">No related seasons found.</div>'; return; }
    node.innerHTML = items.slice(0, 8).map(function (e) {
      var n = e.node, t = (n.title.english || n.title.romaji || 'Anime');
      var sc = n.averageScore ? (n.averageScore / 10).toFixed(1) : '—';
      var cover = n.coverImage && n.coverImage.large || '';
      var rel = (e.relationType || '').replace(/_/g, ' ');
      return '<a class="anime-card" href="' + esc(permalink.split('?')[0]) + '">' +
        '<div class="anime-card-imgwrap"><span class="anime-card-badge">' + esc(rel) + '</span>' +
        '<img class="anime-card-img" loading="lazy" src="' + esc(cover) + '" alt=""></div>' +
        '<div class="anime-card-body"><div class="anime-card-title">' + esc(t) + '</div>' +
        '<div class="anime-card-meta"><span>' + esc(n.format || 'TV') + '</span>' +
        '<span class="rate"><i class="fas fa-star"></i> ' + sc + '</span></div></div></a>';
    }).join('');
  }

  function loadMeta() {
    if (!W.anilistId) return;
    var q = 'query($id:Int){Media(id:$id,type:ANIME){' +
      'title{romaji english native} synonyms coverImage{large extraLarge} bannerImage averageScore episodes duration status format season seasonYear genres isAdult ' +
      'startDate{year month day} endDate{year month day} idMal ' +
      'studios{edges{isMain node{name}}} ' +
      'relations{edges{relationType node{id type title{romaji english} format coverImage{large} averageScore}}} ' +
      'nextAiringEpisode{episode timeUntilAiring} streamingEpisodes{title} description(asHtml:true)}}';
    gql(q, { id: W.anilistId }).then(function (d) { if (d && d.Media) fillMeta(d.Media); }).catch(function () {});
  }

  function loadTop10() {
    var node = el('atsTop10'); if (!node) return;
    gql('{Page(perPage:10){media(type:ANIME,sort:SCORE_DESC,isAdult:false){title{english romaji} format averageScore coverImage{large}}}}')
      .then(function (d) {
        node.innerHTML = d.Page.media.map(function (a, i) {
          var t = (a.title.english || a.title.romaji || 'Anime');
          var sc = a.averageScore ? (a.averageScore / 10).toFixed(1) : '—';
          return '<div class="top10-item"><span class="top10-rank">' + (i + 1) + '</span>' +
            '<img class="top10-thumb" src="' + esc(a.coverImage.large) + '" alt="">' +
            '<span class="top10-info"><span class="top10-name">' + esc(t) + '</span>' +
            '<span class="top10-sub">' + esc(a.format || 'TV') + ' • <i class="fas fa-star" style="color:#ffd043"></i> ' + sc + '</span></span></div>';
        }).join('');
      }).catch(function () { node.innerHTML = ''; });
  }

  /* ================= boot ================= */
  function boot() {
    // If the admin added episodes, render the grid immediately. Otherwise the
    // grid is built from AniList inside fillMeta() (loadMeta below) so old anime
    // with no local episodes still show the full layout.
    if (episodes.length) {
      gridInited = true;
      if (PAGE === 'watch') initWatch(); else initInfo();
    }
    loadMeta();
    loadTop10();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
