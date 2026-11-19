(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LGStream = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  function validateSource(raw) {
    var value = String(raw || '').trim();
    if (!value || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) return null;
    try {
      var parsed = new URL(value);
      if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || !parsed.hostname) return null;
      // Preserve signed path/query bytes; URL is used only to validate the scheme and authority.
      return value;
    } catch (_) { return null; }
  }


  function nativeHlsPlaylist(source) {
    if (!validateSource(source)) return null;
    try {
      var playlist = new URL(source);
      if (playlist.pathname !== '/get.php' || playlist.username || playlist.password || playlist.hash) return null;
      if (playlist.searchParams.getAll('username').length !== 1 || playlist.searchParams.getAll('password').length !== 1) return null;
      if (!playlist.searchParams.get('username') || !playlist.searchParams.get('password')) return null;
      return playlist;
    } catch (_) { return null; }
  }

  function nativeHlsSource(source, playlistSource) {
    var playlist = nativeHlsPlaylist(playlistSource);
    if (!playlist || !validateSource(source)) return source;
    try {
      var stream = new URL(source);
      if (stream.origin !== playlist.origin || stream.username || stream.password || stream.search || stream.hash) return source;
      var shortPath = stream.pathname.match(/^\/([^/]+)\/([^/]+)\/(\d+)$/);
      var livePath = stream.pathname.match(/^\/live\/([^/]+)\/([^/]+)\/(\d+)\.ts$/);
      var parts = shortPath || livePath;
      if (!parts) return source;
      if (decodeURIComponent(parts[1]) !== playlist.searchParams.get('username') ||
          decodeURIComponent(parts[2]) !== playlist.searchParams.get('password')) return source;
      stream.pathname = '/live/' + parts[1] + '/' + parts[2] + '/' + parts[3] + '.m3u8';
      return stream.href;
    } catch (_) { return source; }
  }

  function qualityLabel(width, height) {
    var edge = Math.max(Number(width) || 0, Number(height) || 0);
    var shortEdge = Math.min(Number(width) || 0, Number(height) || 0);
    if (!edge || !shortEdge) return '';
    if (shortEdge >= 2160 || edge >= 3840) return '4K';
    if (shortEdge >= 1440 || edge >= 2560) return 'QHD';
    if (shortEdge >= 1080 || edge >= 1920) return 'FHD';
    if (shortEdge >= 720 || edge >= 1280) return 'HD';
    return 'SD';
  }

  function buildSectionIndex(entries, include, order) {
    var all = [];
    var groups = [];
    var byGroup = Object.create(null);
    var visit = function (entry, index) {
      if (!include(entry, index)) return;
      all.push(index);
      var group = entry.group || '';
      if (!group) return;
      if (!byGroup[group]) { byGroup[group] = []; groups.push(group); }
      byGroup[group].push(index);
    };
    if (order) { for (var position = 0; position < order.length; position += 1) visit(entries[order[position]], order[position]); }
    else entries.forEach(visit);
    return { all: all, groups: groups, byGroup: byGroup };
  }

  var catalogBrands = [
    ['bein', /be[._-]?in(?:[ ._-]*(?:sports?|movies))?|be\s+in[ ._-]+sports?|بي(?:\s+[إأا]|[إأ])ن(?:\s+(?:سبورتس?|موفيز))?/],
    ['ssc', /ssc|[إا]س\s+[إا]س\s+سي/], ['mbc', /mbc|[إا]م\s+بي\s+سي/],
    ['osn', /osn/], ['sky', /sky/], ['rotana', /rotana|روتانا/],
    ['shahid', /shahid|شاهد/], ['starzplay', /starzplay|ستارزبلاي/],
    ['jazeera', /(?:al[ ._-]+)?jazeera|الجزيرة/], ['shasha', /shasha|شاشا/]
  ];
  var catalogBrandPattern = new RegExp('(?:^|[^\\p{L}\\p{N}])(?:' + catalogBrands.map(function (brand) { return '(?<' + brand[0] + '>' + brand[1].source + ')'; }).join('|') + ')(?=$|[^\\p{L}])', 'iu');
  var sportsGroupCode = /(?:^|[\s|:_-])sp(?=$|[\s|:_-])/i;
  var catalogWords = {
    'BEIN SPORTS NEWS': 'beIN سبورت الإخبارية', 'BEIN SPORTS': 'beIN سبورت',
    'BEIN SPORT': 'beIN سبورت', 'BEIN MOVIES': 'beIN موفيز',
    'ENGLISH PREMIER LEAGUE': 'الدوري الإنجليزي الممتاز', 'PREMIER LEAGUE': 'الدوري الممتاز',
    'UEFA CHAMPIONS LEAGUE': 'UEFA دوري أبطال أوروبا', 'CHAMPIONS LEAGUE': 'دوري الأبطال',
    'COPA AMERICA': 'كوبا أمريكا', 'ALRABIAA SPORTS': 'الرابعة الرياضية',
    'AL JAZEERA': 'الجزيرة', 'AL KASS': 'الكأس', 'AL FAJER NEWS': 'الفجر الإخبارية', 'AL FAJER': 'الفجر',
    'ARABIC ENTERTAINMENT': 'ترفيه عربي', 'BBC WORLD NEWS': 'BBC وورلد نيوز',
    'SKY SPORTS MAIN EVENT': 'SKY رياضة الحدث الرئيسي', 'SPORTS MAIN EVENT': 'رياضة الحدث الرئيسي',
    'KANAL D': 'كانال D',
    'NATIONAL GEOGRAPHIC': 'ناشيونال جيوغرافيك', 'ANIMAL PLANET': 'أنيمال بلانيت',
    SPORTS: 'رياضة', SPORT: 'رياضة', SP: 'رياضة', NEWS: 'أخبار', KIDS: 'أطفال', MOVIES: 'أفلام', MOVIE: 'أفلام',
    SERIES: 'مسلسلات', DOCUMENTARY: 'وثائقي', DOCUMENTARIES: 'وثائقي',
    CINEMA: 'سينما', CINEMAX: 'سينماكس', FILMS: 'أفلام', FILM: 'أفلام', SINEMA: 'سينما',
    PREMIUM: 'بريميوم', EXTRA: 'إكسترا', XTRA: 'إكسترا', ACTION: 'أكشن', DRAMA: 'دراما',
    MASR: 'مصر', IRAQ: 'العراق', BOLLYWOOD: 'بوليوود', COMEDY: 'كوميديا',
    ALRABIAA: 'الرابعة', RABIAA: 'الرابعة', SHASHA: 'شاشا', SHAHID: 'شاهد',
    KASS: 'الكأس', JAZEERA: 'الجزيرة', THMANYAH: 'ثمانية', STARZPLAY: 'ستارزبلاي',
    ROTANA: 'روتانا', SHOOF: 'شوف', ALWAN: 'ألوان', MAJESTIC: 'ماجستيك',
    PLATINUM: 'بلاتينيوم', INTERNATIONAL: 'دولية', ENTERTAINMENT: 'ترفيه',
    ARABIC: 'عربي', ARAB: 'عربي', ENGLISH: 'إنجليزي', FRANSA: 'فرنسا', FRENCH: 'فرنسي',
    FRANCE: 'فرنسا', GERMANY: 'ألمانيا', GERMAN: 'ألماني', ITALY: 'إيطاليا', ITALIAN: 'إيطالي',
    SPAIN: 'إسبانيا', SPANISH: 'إسباني', TURKEY: 'تركيا', TURKISH: 'تركي',
    JORDAN: 'الأردن', OMAN: 'عمان', EGYPT: 'مصر', SAUDI: 'السعودية', KUWAIT: 'الكويت',
    LEBANON: 'لبنان', SYRIA: 'سوريا', PALESTINE: 'فلسطين', MOROCCO: 'المغرب',
    TUNISIA: 'تونس', ALGERIA: 'الجزائر', SUDAN: 'السودان', LIBYA: 'ليبيا',
    BLUE: 'بلو', SOLO: 'سولو', MEDIA: 'ميديا', RELAX: 'ريلاكس', GLOBAL: 'جلوبال', MUSLIM: 'مسلم',
    CHANNELS: 'قنوات', CHANNEL: 'قناة', PROGRAM: 'برنامج', PROGRAMS: 'برامج', MUSIC: 'موسيقى', FAMILY: 'عائلة',
    DISCOVERY: 'ديسكفري', EUROSPORT: 'يوروسبورت', DISNEY: 'ديزني', NETFLIX: 'نتفليكس',
    NICKELODEON: 'نيكلوديون', CARTOON: 'كرتون', NICK: 'نيك', BOOMERANG: 'بوميرانغ',
    VIAPLAY: 'فيابلاي', VIASAT: 'فياسات', POLSAT: 'بولسات', PINK: 'بينك', ROYA: 'رؤيا',
    ZIGGO: 'زيغو', SONY: 'سوني', PLUTO: 'بلوتو', TELEMUNDO: 'تيليموندو',
    AMAZON: 'أمازون', PRIME: 'برايم', CANAL: 'كانال', KANAL: 'قناة', ARENA: 'أرينا',
    LEAGUE: 'دوري', PREMIER: 'ممتاز', CHAMPIONS: 'أبطال', BUNDESLIGA: 'الدوري الألماني',
    FOOTBALL: 'كرة القدم', BASKETBALL: 'كرة السلة', HANDBALL: 'كرة اليد', VOLLEYBALL: 'الكرة الطائرة',
    LALIGA: 'الدوري الإسباني', LIGA: 'دوري', TENNIS: 'تنس', GOLF: 'غولف', RACING: 'سباقات',
    EVENTS: 'فعاليات', EVENT: 'فعالية', LIVE: 'مباشر', WORLD: 'العالم', NETWORK: 'شبكة',
    PLUS: 'بلس', SUPER: 'سوبر', SELECT: 'مختارة', PREMIERE: 'عرض أول', CLASSIC: 'كلاسيك',
    HISTORY: 'تاريخ', CRIME: 'جريمة', WILD: 'برية', NATURE: 'طبيعة', SCIENCE: 'علوم',
    INVESTIGATION: 'تحقيقات', ANIMATION: 'رسوم متحركة', JUNIOR: 'جونيور', BABY: 'بيبي',
    RADIO: 'راديو', QURAN: 'قرآن', DOROS: 'دروس', FOOD: 'طبخ', BACKUP: 'احتياط'
  };
  function catalogWordPattern(word) { return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[ ._-]+'); }
  var catalogTranslation = new RegExp('(^|[^\\p{L}])(' + Object.keys(catalogWords).sort(function (a, b) { return b.length - a.length; }).map(catalogWordPattern).join('|') + ')(?=$|[^\\p{L}])', 'giu');

  function catalogBrand(match) { return Object.keys(match.groups).find(function (brand) { return !!match.groups[brand]; }); }
  function catalogPrefix(name, match) { return name.slice(0, match.index).replace(/^[\s|:_-]+|[\s|:_-]+$/g, ''); }
  function shortCountryPrefix(prefix) { return /^(?:[A-Z]{2}|ARA|ENG|FRA|GER|SPA|TUR|KSA)(?:[\s|:_-]+(?:[A-Z]{2}|ARA|ENG|FRA|GER|SPA|TUR|KSA))*$/.test(prefix); }
  function translatedCatalogText(value) {
    return (value.match(/[a-z]+/gi) || []).every(function (word) { return word.length <= 3 || /^(?:bein|uefa|hevc)$/i.test(word) || /^[A-Z]{2,5}$/.test(word); });
  }
  function deduplicateCatalogName(value) {
    var output = []; var previous = ''; var closingToSkip = 0;
    value.split(/([\s|:·\/_،؛()-]+)/).forEach(function (part) {
      if (!part) return;
      if (/^[\s|:·\/_،؛()-]+$/.test(part)) {
        if (closingToSkip) part = part.replace(/\)/g, function (closing) { if (!closingToSkip) return closing; closingToSkip -= 1; return ''; });
        if (part) output.push(part);
        return;
      }
      var word = normalizeCatalogSearch(part);
      if (word.length >= 3 && word === previous && /\p{L}/u.test(part) && !/\d/.test(part)) {
        while (output.length && /^[\s|:·\/_،؛()-]+$/.test(output[output.length - 1])) closingToSkip += (output.pop().match(/\(/g) || []).length;
        return;
      }
      output.push(part); previous = word;
    });
    return output.join('').replace(/^[\s|:·\/_،؛-]+|[\s|:·\/_،؛-]+$/g, '').replace(/\s+/g, ' ');
  }
  function catalogBrandLabel(brand, spelling) {
    if (brand === 'bein') return 'beIN';
    if ((brand === 'ssc' || brand === 'mbc') && /[\u0600-\u06ff]/.test(spelling)) return brand.toUpperCase();
    return arabicCatalogName(spelling) || spelling;
  }

  function arabicCatalogName(name) {
    name = name || '';
    var translated = name.replace(catalogTranslation, function (match, prefix, word, offset) {
      var key = word.toUpperCase().replace(/[ ._-]+/g, ' ');
      var label = catalogWords[key];
      return prefix + label + (/\d/.test(name.charAt(offset + match.length)) ? ' ' : '');
    });
    translated = deduplicateCatalogName(translated);
    return translated === name || !translatedCatalogText(translated) ? '' : translated;
  }

  function arabicGroupName(name) {
    var match = catalogBrandPattern.exec(name);
    if (!match) {
      var translated = arabicCatalogName(name);
      return translated;
    }
    var brand = catalogBrand(match);
    var spelling = match.groups[brand];
    var suffix = name.slice(match.index + match[0].length);
    if (brand === 'bein' && /movies|موفيز/i.test(spelling)) suffix = 'أفلام ' + suffix;
    if (brand === 'bein' || brand === 'ssc') suffix = suffix.replace(/(?:^|[\s|:_-])(?:sports?|سبورتس?|رياضة|channels?)(?=$|[\s|:_-])/gi, ' ');
    var quality = catalogQuality(name);
    suffix = stripCatalogQuality(suffix, quality).replace(/^[\s|:_-]+|[\s|:_-]+$/g, '');
    var label = catalogBrandLabel(brand, spelling) + (suffix ? ' ' + (arabicCatalogName(suffix) || suffix) : '');
    var prefix = stripCatalogQuality(catalogPrefix(name, match), quality).replace(/^[\s|:_-]+|[\s|:_-]+$/g, '');
    if (sportsGroupCode.test(prefix)) { label += ' · رياضة'; prefix = prefix.replace(sportsGroupCode, ' ').replace(/^[\s|:_-]+|[\s|:_-]+$/g, ''); }
    if (prefix && !shortCountryPrefix(prefix)) label = (arabicCatalogName(prefix) || prefix) + ' · ' + label;
    label = label.replace(/\s+/g, ' ');
    return deduplicateCatalogName(label + (quality.length ? ' · ' + quality.join('/') : ''));
  }

  function catalogQuality(name) { return (name.match(/\b(?:SD|HD|FHD|UHD|4K|8K|HEVC)\b/gi) || []).map(function (value) { return value.toUpperCase(); }).filter(function (value, index, values) { return values.indexOf(value) === index; }); }
  function stripCatalogQuality(name, quality) {
    quality.forEach(function (value) { name = name.replace(new RegExp('\\b' + value + '\\b', 'gi'), ' '); });
    return name;
  }
  function channelTitle(name) {
    return stripCatalogQuality(name || '', catalogQuality(name || '')).replace(/\(\s*[\/|,-]*\s*\)|\[\s*[\/|,-]*\s*\]/g, ' ').replace(/^[\s|:\/_-]+|[\s|:\/_-]+$/g, '').replace(/\s+/g, ' ');
  }
  function pictureScale(mode, videoWidth, videoHeight, hostWidth, hostHeight) {
    if (mode === 'contain') return 1;
    var cover = 1;
    if (videoWidth > 0 && videoHeight > 0 && hostWidth > 0 && hostHeight > 0) {
      var relativeAspect = (videoWidth / videoHeight) / (hostWidth / hostHeight);
      cover = Math.max(relativeAspect, 1 / relativeAspect);
    }
    var zoom = mode === 'zoom125' ? 1.25 : mode === 'zoom135' ? 1.35 : 1;
    return Math.min(4, cover * zoom);
  }
  function compactChannelName(name, group) {
    var match = catalogBrandPattern.exec(name || '');
    if (!match) return arabicCatalogName(name);
    var brand = catalogBrand(match); var spelling = match.groups[brand];
    var groupMatch = catalogBrandPattern.exec(group || '');
    var ownGroup = groupMatch && catalogBrand(groupMatch) === brand;
    var suffix = name.slice(match.index + match[0].length);
    if (brand === 'bein' && /movies|موفيز/i.test(spelling)) suffix = 'أفلام ' + suffix;
    var groupQuality = catalogQuality(group || '');
    if (ownGroup && groupQuality.length === 1) suffix = stripCatalogQuality(suffix, groupQuality);
    var prefix = catalogPrefix(name, match);
    if (ownGroup && prefix === catalogPrefix(group, groupMatch)) prefix = '';
    var label = [prefix, catalogBrandLabel(brand, spelling), (arabicCatalogName(suffix) || suffix).trim()].filter(Boolean).join(' ').replace(/\s+/g, ' ');
    label = deduplicateCatalogName(label);
    return label === name ? '' : label;
  }

  function groupDisplayNames(groups) {
    var names = new Map(); var counts = new Map();
    groups.forEach(function (group) {
      var label = arabicGroupName(group) || group;
      names.set(group, label); counts.set(label, (counts.get(label) || 0) + 1);
    });
    names.forEach(function (label, group) {
      if (label !== group && counts.get(label) > 1) {
        var match = catalogBrandPattern.exec(group);
        var prefix = match && group.slice(0, match.index).replace(/^[\s|:_-]+|[\s|:_-]+$/g, '');
        if (prefix) names.set(group, deduplicateCatalogName(label + ' · ' + prefix));
      }
    });
    var resolvedCounts = new Map();
    names.forEach(function (label) { resolvedCounts.set(label, (resolvedCounts.get(label) || 0) + 1); });
    var versions = new Map();
    names.forEach(function (label, group) {
      if (resolvedCounts.get(label) < 2) return;
      var version = (versions.get(label) || 0) + 1; versions.set(label, version);
      names.set(group, label + ' (' + version + ')');
    });
    return names;
  }

  function groupFamilyName(name) {
    var label = name.replace(/[a-z]+/gi, function (word) {
      var key = word.toUpperCase();
      return Object.prototype.hasOwnProperty.call(catalogWords, key) ? catalogWords[key] : word;
    });
    label = deduplicateCatalogName(label);
    return normalizeCatalogSearch(label).replace(/\b(?:sd|hd|fhd|uhd|4k|8k|hevc)\b/g, '').replace(/\b(?:sp|sports?)\b/g, 'رياضة').replace(/سبورتس?/g, 'رياضة').replace(/\bmovies?\b/g, 'افلام').replace(/[\s|:/_-]+/g, ' ').trim();
  }

  function orderedCatalogGroups(groups) {
    var families = new Map();
    var runs = [];
    groups.forEach(function (group) {
      var match = catalogBrandPattern.exec(group);
      // Remove quality tokens only. Country, language and content words keep their identity.
      var family = match ? 'brand:' + catalogBrand(match) : 'name:' + (groupFamilyName(group) || group);
      if (!families.has(family)) {
        var run = [];
        families.set(family, run);
        runs.push(run);
      }
      families.get(family).push(group);
    });
    return runs.flatMap(function (run) {
      if (run.length < 2) return run;
      var genreOrder = ['sports', 'movies', 'news', 'kids', 'documentary', 'other'];
      var genres = new Map();
      run.forEach(function (group) {
        var genre = sportsGroupCode.test(group) ? 'sports' : groupCategory(group);
        if (!genres.has(genre)) genres.set(genre, []);
        genres.get(genre).push(group);
      });
      var byGenre = [];
      genreOrder.forEach(function (genre) { if (genres.has(genre)) byGenre.push.apply(byGenre, genres.get(genre)); });
      var versions = new Map();
      byGenre.forEach(function (group) {
        var key = groupFamilyName(group);
        if (!versions.has(key)) versions.set(key, []);
        versions.get(key).push(group);
      });
      return Array.from(versions.values()).flat();
    });
  }

  // candidates (optional): indexes known to contain a prefix of query, from a
  // previous result's `matched`; narrowing a query then rescans only those.
  function searchCatalog(entries, query, sectionForIndex, limit, liveIndexes, candidates) {
    var counts = { tv: 0, movies: 0, series: 0 };
    var matches = { tv: [], movies: [], series: [] };
    var searchArabic = /[\u0600-\u06ff]/.test(query);
    var normalizedQuery = normalizeCatalogSearch(query);
    var queryWords = normalizedQuery.match(/[\u0600-\u06ff]+/g) || [];
    var compactBrand = catalogBrandPattern.exec(query);
    var hints = searchArabic && normalizedQuery.length >= 2 ? Object.keys(catalogWords).filter(function (word) {
      var labelWords = normalizeCatalogSearch(catalogWords[word]).match(/[\u0600-\u06ff]+/g) || [];
      return queryWords.some(function (queryWord) { return labelWords.some(function (labelWord) { return labelWord.indexOf(queryWord) >= 0 || queryWord.indexOf(labelWord) >= 0; }); });
    }) : [];
    var patterns = hints.map(catalogWordPattern);
    if (compactBrand) patterns.push(catalogBrands.find(function (brand) { return brand[0] === catalogBrand(compactBrand); })[1].source);
    var aliasHint = patterns.length ? new RegExp(patterns.join('|'), 'iu') : null;
    function collect(index, section) {
      if (!matches[section]) return;
      counts[section] += 1;
      var list = matches[section];
      if (list.length < limit || index < list[list.length - 1]) {
        list.push(index); list.sort(function (a, b) { return a - b; });
        if (list.length > limit) list.pop();
      }
    }
    var matched = [];
    function direct(index) {
      if ((entries[index].name || '').toLocaleLowerCase().indexOf(query) < 0) return;
      matched.push(index); collect(index, sectionForIndex(index));
    }
    if (candidates) candidates.forEach(direct);
    else for (var position = 0; position < entries.length; position++) direct(position);
    function matchAlias(index) {
      var name = entries[index].name || '';
      if (name.toLocaleLowerCase().indexOf(query) >= 0 || sectionForIndex(index) !== 'tv' || !aliasHint.test(name)) return;
      var full = arabicCatalogName(name) || name;
      var compact = compactChannelName(name, '') || name;
      if (normalizeCatalogSearch(full).indexOf(normalizedQuery) >= 0 || normalizeCatalogSearch(compact).indexOf(normalizedQuery) >= 0) collect(index, 'tv');
    }
    if (aliasHint) {
      if (liveIndexes) liveIndexes.forEach(matchAlias);
      else entries.forEach(function (_, index) { matchAlias(index); });
    }
    return { counts: counts, matches: matches, matched: matched };
  }

  function normalizeCatalogSearch(value) {
    return value.toLocaleLowerCase().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/[٠-٩]/g, function (digit) { return String(digit.charCodeAt(0) - 0x0660); }).replace(/[\u0640\u064b-\u065f]/g, '').replace(/سبورتس/g, 'سبورت');
  }

  function youtubeSearchTarget(name, year) {
    var title = String(name || '').trim().replace(/\s+/g, ' ');
    var releaseYear = String(year || '').trim();
    if (!title) return null;
    var titleAndYear = title;
    if (releaseYear && !(new RegExp('(^|\\D)' + releaseYear.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\D|$)')).test(title)) titleAndYear += ' ' + releaseYear;
    return 'https://www.youtube.com/tv?launch=voice&vq=' + encodeURIComponent('Search for ' + titleAndYear + ' on YouTube');
  }

  function createSwitchScheduler(commit, timers, delay) {
    timers = timers || {
      setTimeout: function (callback, delay) { return setTimeout(callback, delay); },
      clearTimeout: function (handle) { clearTimeout(handle); }
    };
    delay = delay === undefined ? 120 : delay;
    var pending = null;
    var revision = 0;
    function cancel() {
      revision += 1;
      if (pending !== null) timers.clearTimeout(pending);
      pending = null;
    }
    return {
      request: function (value) {
        cancel();
        var ownRevision = revision;
        pending = timers.setTimeout(function () {
          if (revision !== ownRevision) return;
          pending = null;
          commit(value);
        }, delay);
      },
      immediate: function (value) { cancel(); commit(value); },
      cancel: cancel
    };
  }

  function createPlayer(options) {
    var generation = 0;
    var active = null;
    var now = options.now || function () { return performance.now(); };
    var emit = options.onState || function () {};
    var timers = options.timers || {
      setTimeout: function (callback, delay) { return setTimeout(callback, delay); },
      clearTimeout: function (handle) { clearTimeout(handle); }
    };
    var startupTimeoutMs = options.startupTimeoutMs || 15000;
    // After the first progress, a stream that shows no media-time change for
    // this long (outside pause/seek) is reported as 'stall-timeout'. Short
    // waits that recover on their own are left alone.
    var stallTimeoutMs = options.stallTimeoutMs || 15000;
    var stallCheckMs = options.stallCheckMs || 2500;
    function snapshot(entry) {
      return {
        channel: entry.channel,
        state: entry.state,
        playingMs: entry.playingMs,
        sourceMs: entry.sourceMs,
        metadataMs: entry.metadataMs,
        progressMs: entry.progressMs,
        firstFrameMs: entry.firstFrameMs,
        frameApi: entry.frameApi,
        stalls: entry.stalls,
        stallMs: Math.round(entry.stallMs),
        width: entry.video.videoWidth || 0,
        height: entry.video.videoHeight || 0,
        errorCode: entry.errorCode || 0
      };
    }
    function notify(entry) { if (active === entry) emit(snapshot(entry)); }
    function clearStartup(entry) {
      if (entry.startupTimer !== null) timers.clearTimeout(entry.startupTimer);
      entry.startupTimer = null;
    }
    function clearStall(entry) {
      if (entry.stallTimer !== null) timers.clearTimeout(entry.stallTimer);
      entry.stallTimer = null;
    }
    function armStall(entry) {
      if (!entry.watchStall || entry.stallTimer !== null) return;
      if (entry.lastProgressAt === null) entry.lastProgressAt = now();
      entry.stallTimer = timers.setTimeout(function check() {
        entry.stallTimer = null;
        if (active !== entry || entry.state === 'ended') return;
        var video = entry.video;
        if (video.paused || video.seeking || entry.seekInProgress) entry.lastProgressAt = now();
        else if (now() - entry.lastProgressAt >= stallTimeoutMs) { fail(entry, 'stall-timeout'); return; }
        entry.stallTimer = timers.setTimeout(check, stallCheckMs);
      }, stallCheckMs);
    }
    function finishWait(entry) {
      if (entry.waitingSince !== null) {
        entry.stallMs += now() - entry.waitingSince;
        entry.waitingSince = null;
      }
    }
    function fail(entry, state) {
      finishWait(entry);
      entry.state = state;
      var failed = snapshot(entry);
      release();
      emit(failed);
    }
    function play(entry) {
      var revision = ++entry.playRevision;
      var promise = entry.video.play();
      if (promise && promise.catch) promise.catch(function () {
        if (active !== entry || entry.playRevision !== revision) return;
        fail(entry, 'play-rejected');
      });
    }
    function armStartup(entry) {
      clearStartup(entry);
      if (entry.progressMs !== null || entry.firstFrameMs !== null) return;
      var revision = ++entry.startupRevision;
      entry.startupTimer = timers.setTimeout(function () {
        if (active !== entry || entry.startupRevision !== revision || entry.startupTimer === null || entry.progressMs !== null || entry.firstFrameMs !== null) return;
        fail(entry, 'startup-timeout');
      }, startupTimeoutMs);
    }
    function release() {
      generation += 1;
      var old = active;
      active = null;
      if (!old) return;
      clearStartup(old); clearStall(old);
      old.listeners.forEach(function (item) { old.video.removeEventListener(item[0], item[1]); });
      if (old.frameHandle !== null && old.video.cancelVideoFrameCallback) old.video.cancelVideoFrameCallback(old.frameHandle);
      old.video.pause();
      old.video.removeAttribute('src');
      old.video.load();
      options.unmountVideo(old.video);
    }
    function start(source, channel, requestedAt, startOptions) {
      var valid = validateSource(source);
      if (!valid) { release(); emit({ state: 'error', channel: channel }); return false; }
      release();
      var ownGeneration = generation;
      var video = options.createVideo();
      var started = now();
      var entry = {
        video: video, channel: channel, state: 'loading', started: started, playingMs: null,
        requested: typeof requestedAt === 'number' && isFinite(requestedAt) && requestedAt <= started ? requestedAt : started,
        sourceMs: null, metadataMs: null,
        progressMs: null, lastMediaTime: 0, lastProgressAt: null, stallTimer: null, watchStall: !!(startOptions && startOptions.watchStall), startupTimer: null, startupRevision: 0, playRevision: 0,
        firstFrameMs: null, frameApi: typeof video.requestVideoFrameCallback === 'function',
        frameHandle: null, listeners: [], stalls: 0, stallMs: 0, waitingSince: null, seekInProgress: false, seekMediaTime: null, errorCode: 0
      };
      active = entry;
      function validEntry() { return active === entry && generation === ownGeneration; }
      function on(name, callback) {
        var guarded = function () { if (validEntry()) callback(); };
        video.addEventListener(name, guarded);
        entry.listeners.push([name, guarded]);
      }
      on('playing', function () {
        entry.seekInProgress = false; entry.seekMediaTime = null;
        if (entry.playingMs === null) {
          entry.playingMs = Math.round(now() - entry.requested);
          entry.lastMediaTime = video.currentTime || 0;
        }
        finishWait(entry); entry.state = 'playing'; notify(entry);
      });
      on('timeupdate', function () {
        var mediaTime = video.currentTime;
        if (entry.seekInProgress && entry.seekMediaTime !== null && !video.paused && !video.seeking && isFinite(mediaTime) && mediaTime > entry.seekMediaTime) {
          entry.seekInProgress = false; entry.seekMediaTime = null;
        }
        if (entry.playingMs === null || video.paused || video.seeking || !isFinite(mediaTime)) return;
        if (entry.progressMs === null) {
          if (mediaTime > entry.lastMediaTime) {
            entry.progressMs = Math.round(now() - entry.requested);
            entry.lastProgressAt = now();
            clearStartup(entry); armStall(entry); notify(entry);
          }
        } else if (mediaTime !== entry.lastMediaTime) entry.lastProgressAt = now();
        entry.lastMediaTime = mediaTime;
      });
      on('seeking', function () {
        // Seeking and its refill are user-requested work, not playback stalls.
        finishWait(entry); entry.seekInProgress = true; entry.seekMediaTime = null;
      });
      on('seeked', function () { if (entry.seekInProgress) entry.seekMediaTime = video.currentTime; });
      on('waiting', function () {
        if (!entry.seekInProgress && !video.seeking && entry.playingMs !== null && entry.waitingSince === null) {
          entry.waitingSince = now(); entry.stalls += 1;
        }
        entry.state = 'waiting'; notify(entry);
      });
      on('pause', function () {
        if (!video.paused) return;
        clearStartup(entry); finishWait(entry); entry.state = 'paused'; notify(entry);
      });
      on('ended', function () { clearStartup(entry); finishWait(entry); entry.state = 'ended'; notify(entry); });
      on('loadedmetadata', function () {
        if (entry.metadataMs === null) entry.metadataMs = Math.round(now() - entry.requested);
        notify(entry);
      });
      on('resize', function () { notify(entry); });
      on('error', function () {
        var code = video.error && video.error.code;
        entry.errorCode = typeof code === 'number' && code >= 1 && code <= 4 ? code : 0;
        fail(entry, 'error');
      });
      options.mountVideo(video);
      video.src = valid;
      entry.sourceMs = Math.round(now() - entry.requested);
      if (entry.frameApi) {
        entry.frameHandle = video.requestVideoFrameCallback(function () {
          if (!validEntry()) return;
          entry.firstFrameMs = Math.round(now() - entry.requested);
          clearStartup(entry); armStall(entry);
          notify(entry);
        });
      }
      notify(entry);
      armStartup(entry);
      video.load();
      play(entry);
      return true;
    }
    return {
      start: start,
      stop: function () { release(); emit({ state: 'idle' }); },
      pause: function () {
        if (!active) return;
        active.playRevision += 1;
        clearStartup(active);
        active.video.pause();
      },
      resume: function () {
        var entry = active;
        if (!entry) return;
        armStartup(entry);
        play(entry);
      },
      toggle: function () { if (active) { if (active.video.paused) this.resume(); else this.pause(); } }
    };
  }
  var categoryRules = [['sports', /(?:^|[\s|:_-])(?:(?:ال)?رياض(?:ة|ية)|سبورتس?)(?=$|[\s|:_\d-])|\bsports?(?=\b|\d)/], ['movies', /أفلام|افلام|سينما|موفيز|\bmovies?(?=\b|\d)|\bcinema\b/], ['news', /أخبار|اخبار|الإخبارية|\bnews\b/], ['kids', /أطفال|اطفال|كرتون|\bkids?\b|\bchildren\b/], ['documentary', /وثائق|\bdocumentar(?:y|ies)\b/]];
  function nameCategory(name) {
    var text = String(name || '').toLowerCase();
    var matches = categoryRules.filter(function (rule) { return rule[1].test(text); });
    return matches.length === 1 ? matches[0][0] : matches.length ? 'other' : null;
  }
  function groupCategory(name) {
    var category = nameCategory(name);
    return category || (sportsGroupCode.test(name || '') ? 'sports' : 'other');
  }
  function channelCategory(name) {
    var category = nameCategory(name);
    if (category) return category === 'other' ? null : category;
    var text = String(name || '');
    if (/(?:^|[^\p{L}\p{N}])(?:ssc(?:[ ._-]*extra)?|be[._-]?in|بي(?:\s+[إأا]|[إأ])ن|[إا]س\s+[إا]س\s+سي)[ ._-]*\d+(?=$|[^\p{L}])/iu.test(text)) return 'sports';
    if (/(?:^|[^\p{L}\p{N}])(?:mbc|[إا]م\s+بي\s+سي)[ ._-]*(?:2|max|action|bollywood|ماكس|أكشن|بوليوود)(?=$|[^\p{L}\p{N}])/iu.test(text) || /روتانا\s+سينما/i.test(text)) return 'movies';
    return null;
  }

  // Stable identity of a catalogue item that survives provider refreshes:
  // the numeric stream id at the end of an Xtream-style path, tagged with
  // its section. Other URLs fall back to a 32-bit hash; the key is never a
  // URL and cannot be turned back into one.
  var KEY_SPACE = 4294967296;
  // Runs over every catalogue item, so it avoids regular expressions.
  function entryKey(url) {
    url = String(url || '');
    var end = url.length; var query = url.indexOf('?'); var hashAt = url.indexOf('#');
    if (query >= 0) end = query; if (hashAt >= 0 && hashAt < end) end = hashAt;
    var lower = url.indexOf('/series/') >= 0 || url.indexOf('/movie/') >= 0 || url.indexOf('/SERIES/') >= 0 || url.indexOf('/MOVIE/') >= 0 ? url.toLowerCase() : url;
    var section = lower.indexOf('/series/') >= 0 ? 3 : lower.indexOf('/movie/') >= 0 ? 2 : 1;
    var start = url.lastIndexOf('/', end - 1) + 1; var value = 0; var length = 0;
    for (var at = start; at < end; at += 1) {
      var code = url.charCodeAt(at);
      if (code === 46 && length) break;
      if (code < 48 || code > 57 || length >= 9) { length = -1; break; }
      value = value * 10 + code - 48; length += 1;
    }
    if (length > 0) return section * KEY_SPACE + value;
    var hash = 2166136261;
    for (var index = 0; index < url.length; index += 1) { hash ^= url.charCodeAt(index); hash = Math.imul(hash, 16777619) >>> 0; }
    return (section + 3) * KEY_SPACE + hash;
  }
  // Provider serial (Xtream stream id) for movies/series; panels assign ids in
  // the order items are added, so a larger id is usually a newer addition.
  function providerSerial(key) {
    var section = Math.floor(Number(key) / KEY_SPACE);
    return section === 2 || section === 3 ? Number(key) - section * KEY_SPACE : null;
  }
  // Release year written in a title, e.g. "Name (2021)" or "Name - 2021".
  function titleYear(name, now) {
    name = String(name || ''); var latest = (now || new Date()).getFullYear() + 1;
    var match = /[(\[]\s*((?:19|20)\d{2})\s*[)\]]/.exec(name) || /(?:^|[\s\-–|])((?:19|20)\d{2})\s*$/.exec(name);
    var year = match ? Number(match[1]) : 0;
    return year >= 1900 && year <= latest ? year : 0;
  }
  function sortedKeys(keys) { return Float64Array.from(keys).sort(); }
  function hasSortedKey(sorted, key) {
    var low = 0; var high = sorted.length - 1;
    while (low <= high) { var middle = (low + high) >>> 1; var value = sorted[middle]; if (value === key) return true; if (value < key) low = middle + 1; else high = middle - 1; }
    return false;
  }
  // Flags items whose key was not in the previous refresh key list.
  function newItemFlags(keys, previousSorted) {
    var flags = new Uint8Array(keys.length); var count = 0;
    if (!previousSorted || !previousSorted.length) return { flags: flags, count: 0 };
    for (var index = 0; index < keys.length; index += 1) if (!hasSortedKey(previousSorted, keys[index])) { flags[index] = 1; count += 1; }
    return { flags: flags, count: count };
  }
  // Move the items of block (kept in their current relative order) so the
  // block starts at position `to` of the list without them.
  function moveBlock(list, block, to) {
    var chosen = new Set(block); var moving = []; var rest = [];
    list.forEach(function (item) { (chosen.has(item) ? moving : rest).push(item); });
    to = Math.max(0, Math.min(rest.length, to));
    return rest.slice(0, to).concat(moving, rest.slice(to));
  }
  // One master order per section: groups (new groups first, then the saved
  // order, then the default provider-family order) and, inside each group,
  // new items first, then the saved order, then provider order.
  function buildDisplayOrder(entries, sectionOf, options) {
    options = options || {};
    var keys = options.keys; var fresh = options.newFlags; var custom = options.custom || {};
    var groupOrder = custom.groupOrder || {}; var channelOrder = custom.channelOrder || {};
    var result = {};
    ['tv', 'movies', 'series'].forEach(function (section) { result[section] = { groups: [], byGroup: new Map(), order: null, newCount: 0, newGroups: new Set() }; });
    for (var index = 0; index < entries.length; index += 1) {
      var own = result[sectionOf(index)]; if (!own) continue;
      var group = entries[index].group || '';
      var members = own.byGroup.get(group);
      if (!members) { members = []; own.byGroup.set(group, members); own.groups.push(group); }
      members.push(index);
      if (fresh && fresh[index]) own.newCount += 1;
    }
    Object.keys(result).forEach(function (section) {
      var own = result[section];
      var named = own.groups.filter(function (group) { return group; });
      var defaults = (options.orderGroups || function (groups) { return groups; })(named);
      var saved = Array.isArray(groupOrder[section]) ? groupOrder[section] : [];
      var present = new Set(named); var placed = new Set(); var ordered = [];
      saved.forEach(function (group) { if (present.has(group) && !placed.has(group)) { placed.add(group); ordered.push(group); } });
      defaults.forEach(function (group) { if (!placed.has(group)) { placed.add(group); ordered.push(group); } });
      if (fresh) {
        named.forEach(function (group) { if (own.byGroup.get(group).every(function (item) { return fresh[item]; })) own.newGroups.add(group); });
        // A new group the owner already placed keeps its place.
        var leading = function (group) { return own.newGroups.has(group) && saved.indexOf(group) < 0; };
        if (own.newGroups.size) ordered = ordered.filter(leading).concat(ordered.filter(function (group) { return !leading(group); }));
      }
      if (own.byGroup.has('')) ordered.push('');
      var order = [];
      ordered.forEach(function (group) {
        var members = own.byGroup.get(group); var savedKeys = channelOrder[section + '\u0001' + group];
        if (keys && Array.isArray(savedKeys) && savedKeys.length) {
          // The owner's arrangement wins; items it does not mention yet go
          // first when new, otherwise after it in provider order.
          var byKey = new Map(); members.forEach(function (item) { if (!byKey.has(keys[item])) byKey.set(keys[item], item); });
          var used = new Set(); var arranged = [];
          savedKeys.forEach(function (key) { var item = byKey.get(key); if (item !== undefined && !used.has(item)) { used.add(item); arranged.push(item); } });
          var before = []; var after = [];
          members.forEach(function (item) { if (!used.has(item)) (fresh && fresh[item] ? before : after).push(item); });
          members = before.concat(arranged, after);
        } else if (fresh) members = members.filter(function (item) { return fresh[item]; }).concat(members.filter(function (item) { return !fresh[item]; }));
        own.byGroup.set(group, members);
        for (var position = 0; position < members.length; position += 1) order.push(members[position]);
      });
      own.groups = ordered; own.order = Int32Array.from(order);
    });
    return result;
  }
  // Xtream login typed on the TV becomes the same get.php playlist link.
  function xtreamPlaylistUrl(server, username, password) {
    var raw = String(server || '').trim(); username = String(username || '').trim(); password = String(password || '');
    if (!raw || !username || !password || /[\u0000-\u001f\u007f]/.test(username + password)) return null;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) return null;
    if (!/^https?:\/\//i.test(raw)) raw = 'http://' + raw;
    try {
      var parsed = new URL(raw);
      if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname || parsed.username || parsed.password) return null;
      var link = new URL('/get.php', parsed.origin);
      link.searchParams.set('username', username); link.searchParams.set('password', password);
      link.searchParams.set('type', 'm3u_plus'); link.searchParams.set('output', 'ts');
      return validateSource(link.href);
    } catch (_) { return null; }
  }
  return { entryKey: entryKey, providerSerial: providerSerial, titleYear: titleYear, sortedKeys: sortedKeys, hasSortedKey: hasSortedKey, newItemFlags: newItemFlags, moveBlock: moveBlock, buildDisplayOrder: buildDisplayOrder, xtreamPlaylistUrl: xtreamPlaylistUrl, nativeHlsPlaylist: nativeHlsPlaylist, nativeHlsSource: nativeHlsSource, groupCategory: groupCategory, channelCategory: channelCategory, validateSource: validateSource, qualityLabel: qualityLabel, buildSectionIndex: buildSectionIndex, orderedCatalogGroups: orderedCatalogGroups, groupDisplayNames: groupDisplayNames, arabicGroupName: arabicGroupName, arabicCatalogName: arabicCatalogName, compactChannelName: compactChannelName, channelTitle: channelTitle, pictureScale: pictureScale, searchCatalog: searchCatalog, youtubeSearchTarget: youtubeSearchTarget, createSwitchScheduler: createSwitchScheduler, createPlayer: createPlayer };
}));
