(function () {
  "use strict";

  var REGION_ORDER = [
    "na",
    "ca_housing",
    "ca_mortgage",
    "ca_appraisal",
    "cn",
    "in",
  ];
  var REGION_HEADING = {
    na: "북미 증시·경제",
    ca_housing: "캐나다 주택·부동산",
    ca_mortgage: "캐나다 모기지",
    ca_appraisal: "캐나다 감정 평가",
    cn: "중국·아시아",
    in: "인도",
  };
  var REGION_BADGE = {
    na: "북미",
    ca_housing: "캐나다 주택",
    ca_mortgage: "캐나다 모기지",
    ca_appraisal: "캐나다 감정",
    cn: "중국·아시아",
    in: "인도",
  };

  var TIME_LABEL = {
    "36": "어제·오늘(36시간)",
    today: "오늘(토론토 날짜)",
    week: "이번 주(7일)",
    all: "전체 기간",
  };

  var RSS2JSON_BASE = "https://api.rss2json.com/v1/api.json";
  var HOT_PICK_COUNT = 8;
  var BODY_TRANSLATE_MAX = 2800;

  var els = {
    newsSections: document.getElementById("newsSections"),
    statusText: document.getElementById("statusText"),
    lastUpdated: document.getElementById("lastUpdated"),
    editionDate: document.getElementById("editionDate"),
    errorBox: document.getElementById("errorBox"),
    emptyState: document.getElementById("emptyState"),
    btnRefresh: document.getElementById("btnRefresh"),
    btnPrint: document.getElementById("btnPrint"),
    btnTranslate: document.getElementById("btnTranslate"),
    filterBtns: document.querySelectorAll("[data-filter]"),
    timeBtns: document.querySelectorAll("[data-time]"),
  };

  var FEEDS = [];
  var currentFilter = "all";
  var currentTimePreset = "36";
  var allItems = [];
  var translateRunning = false;

  function displayLabel(meta) {
    return meta.labelKo || meta.label;
  }

  function rss2jsonUrl(feedUrl) {
    var params = new URLSearchParams({ rss_url: feedUrl });
    var key = window.RSS2JSON_API_KEY;
    if (key) params.set("api_key", key);
    return RSS2JSON_BASE + "?" + params.toString();
  }

  function stripHtml(html) {
    var tmp = document.createElement("div");
    tmp.innerHTML = html || "";
    return (tmp.textContent || tmp.innerText || "").replace(/\s+/g, " ").trim();
  }

  function mergeBody(contentHtml, descHtml) {
    var c = stripHtml(contentHtml);
    var d = stripHtml(descHtml);
    if (c && d && d.length >= 20 && c.startsWith(d.slice(0, Math.min(40, d.length)))) {
      return c;
    }
    if (c && d) {
      return d + "\n\n" + c;
    }
    return c || d || "";
  }

  function parsePubDate(str) {
    var t = Date.parse(str);
    return Number.isNaN(t) ? 0 : t;
  }

  function formatDate(isoOrStr) {
    var d = new Date(isoOrStr);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("ko-KR", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  }

  function torontoCalendarDay(d) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  }

  function isSameTorontoDay(isoOrStr, refDate) {
    var itemMs = parsePubDate(isoOrStr);
    if (!itemMs) return false;
    return torontoCalendarDay(new Date(itemMs)) === torontoCalendarDay(refDate || new Date());
  }

  function passesTime(item) {
    if (currentTimePreset === "all") return true;
    var now = Date.now();
    if (currentTimePreset === "36") {
      return now - item.sortKey <= 36 * 60 * 60 * 1000;
    }
    if (currentTimePreset === "week") {
      return now - item.sortKey <= 7 * 24 * 60 * 60 * 1000;
    }
    if (currentTimePreset === "today") {
      return isSameTorontoDay(item.pubDate, new Date());
    }
    return true;
  }

  function setEditionDate() {
    var now = new Date();
    var s = new Intl.DateTimeFormat("ko-KR", {
      timeZone: "America/Toronto",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(now);
    els.editionDate.dateTime = now.toISOString();
    els.editionDate.textContent = s;
  }

  async function loadFeedConfig() {
    var res = await fetch("feeds.json", { cache: "no-store" });
    if (!res.ok) throw new Error("설정 파일(feeds.json)을 불러올 수 없어요.");
    FEEDS = await res.json();
  }

  async function fetchFeed(meta) {
    var res = await fetch(rss2jsonUrl(meta.url), { method: "GET" });
    if (!res.ok) throw new Error(displayLabel(meta) + ": 연결 오류 " + res.status);
    var data = await res.json();
    if (data.status !== "ok") {
      throw new Error(data.message || displayLabel(meta) + ": 뉴스 목록 오류");
    }
    var items = data.items || [];
    return items.map(function (item) {
      return {
        title: stripHtml(item.title),
        link: item.link,
        pubDate: item.pubDate,
        body: mergeBody(item.content, item.description),
        sourceLabel: displayLabel(meta),
        region: meta.region,
        sortKey: parsePubDate(item.pubDate),
      };
    });
  }

  function mergeAndSort(batches) {
    var seen = new Set();
    var merged = [];
    batches.forEach(function (batch) {
      batch.forEach(function (item) {
        var key = item.title + "|" + item.link;
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(item);
      });
    });
    merged.sort(function (a, b) {
      return b.sortKey - a.sortKey;
    });
    return merged;
  }

  function matchesRegion(item) {
    if (currentFilter === "all") return true;
    return item.region === currentFilter;
  }

  function getFilteredItems() {
    return allItems.filter(function (item) {
      return passesTime(item) && matchesRegion(item);
    });
  }

  function updateStatusLine() {
    var filtered = getFilteredItems();
    var m = filtered.length;
    var n = allItems.length;
    var tl = TIME_LABEL[currentTimePreset] || "";
    if (n === 0) {
      els.statusText.textContent = "기사가 아직 없어요.";
      return;
    }
    els.statusText.textContent =
      "시간 범위: " + tl + " · 보이는 기사 " + m + "개 (저장된 전체 " + n + "개)";
  }

  function createArticleEl(item, compact) {
    var art = document.createElement("article");
    art.className = "news-article" + (compact ? " news-article--compact" : "");
    art.dataset.link = item.link;

    var meta = document.createElement("div");
    meta.className = "article-meta";

    var src = document.createElement("span");
    src.className = "article-source";
    src.textContent = item.sourceLabel;

    var badge = document.createElement("span");
    badge.className = "article-badge region-" + item.region;
    badge.textContent = REGION_BADGE[item.region] || item.region;

    var time = document.createElement("time");
    time.dateTime = item.pubDate || "";
    time.textContent = formatDate(item.pubDate);

    meta.appendChild(src);
    meta.appendChild(badge);
    meta.appendChild(time);

    var hEn = document.createElement("h2");
    hEn.className = "article-title article-title-en";
    hEn.setAttribute("lang", "en");
    hEn.textContent = item.title;

    var hKo = document.createElement("h2");
    hKo.className = "article-title article-title-ko";
    hKo.setAttribute("lang", "ko");
    hKo.setAttribute("aria-hidden", "true");
    hKo.textContent = "";

    art.appendChild(meta);
    art.appendChild(hEn);
    art.appendChild(hKo);

    if (item.body) {
      var bodyEn = document.createElement("div");
      bodyEn.className = "article-body article-body-en";
      bodyEn.setAttribute("lang", "en");
      bodyEn.textContent = item.body;

      var bodyKo = document.createElement("div");
      bodyKo.className = "article-body article-body-ko";
      bodyKo.setAttribute("lang", "ko");
      bodyKo.setAttribute("aria-hidden", "true");
      bodyKo.textContent = "";

      art.appendChild(bodyEn);
      art.appendChild(bodyKo);
    }

    var foot = document.createElement("p");
    foot.className = "article-footnote";
    var a = document.createElement("a");
    a.href = item.link;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "원문 기사 열기 (언론사 사이트) →";
    foot.appendChild(a);
    art.appendChild(foot);

    return art;
  }

  function renderSection(reg, slice) {
    if (!slice.length) return;
    var section = document.createElement("section");
    section.className = "paper-section region-" + reg;
    var h = document.createElement("h2");
    h.className = "paper-section-title";
    h.textContent = REGION_HEADING[reg];
    section.appendChild(h);
    var cols = document.createElement("div");
    cols.className =
      "paper-columns" + (currentFilter === "all" ? " paper-columns-2" : "");
    slice.forEach(function (item) {
      cols.appendChild(createArticleEl(item, false));
    });
    section.appendChild(cols);
    els.newsSections.appendChild(section);
  }

  function renderHotStrip(hotItems) {
    if (!hotItems.length) return;
    var wrap = document.createElement("section");
    wrap.className = "hot-strip";
    var h = document.createElement("h2");
    h.className = "hot-strip-title";
    h.textContent =
      "지금 보는 시간 범위에서 가장 최근 소식 (핫 픽)";
    wrap.appendChild(h);
    var p = document.createElement("p");
    p.className = "hot-strip-deck";
    p.textContent =
      "어제·오늘 시장에서 올라온 뉴스 위주로, 같은 기간 안에서 가장 새 글부터 모았어요.";
    wrap.appendChild(p);
    var list = document.createElement("div");
    list.className = "hot-strip-list";
    hotItems.forEach(function (item) {
      list.appendChild(createArticleEl(item, true));
    });
    wrap.appendChild(list);
    els.newsSections.appendChild(wrap);
  }

  function render() {
    var filtered = getFilteredItems();
    els.newsSections.innerHTML = "";
    updateStatusLine();

    if (filtered.length === 0) {
      els.emptyState.classList.remove("hidden");
      return;
    }
    els.emptyState.classList.add("hidden");

    var hotLinks = new Set();
    if (currentFilter === "all") {
      var hot = filtered.slice(0, HOT_PICK_COUNT);
      hot.forEach(function (it) {
        hotLinks.add(it.link);
      });
      renderHotStrip(hot);
    }

    if (currentFilter === "all") {
      REGION_ORDER.forEach(function (reg) {
        var slice = filtered.filter(function (i) {
          return i.region === reg && !hotLinks.has(i.link);
        });
        renderSection(reg, slice);
      });
    } else {
      renderSection(currentFilter, filtered);
    }
  }

  function setLoading(isLoading) {
    els.newsSections.setAttribute("aria-busy", isLoading ? "true" : "false");
    els.btnRefresh.disabled = isLoading;
    if (isLoading) {
      els.statusText.textContent = "뉴스를 가져오는 중이에요…";
    }
  }

  function showError(msg) {
    els.errorBox.textContent = msg;
    els.errorBox.classList.remove("hidden");
  }

  function hideError() {
    els.errorBox.classList.add("hidden");
    els.errorBox.textContent = "";
  }

  async function loadNews() {
    hideError();
    setLoading(true);
    els.statusText.textContent = "여러 출처에서 모으는 중이에요…";

    try {
      if (!FEEDS.length) await loadFeedConfig();

      var results = await Promise.allSettled(
        FEEDS.map(function (f) {
          return fetchFeed(f);
        })
      );

      var batches = [];
      var errors = [];
      results.forEach(function (r, i) {
        if (r.status === "fulfilled") {
          batches.push(r.value);
        } else {
          errors.push(
            displayLabel(FEEDS[i]) +
              ": " +
              (r.reason && r.reason.message ? r.reason.message : "실패")
          );
        }
      });

      if (batches.length === 0) {
        throw new Error(
          errors.join(" / ") ||
            "뉴스를 불러오지 못했어요. file:// 대신 웹 서버로 열었는지, rss2json API 키(RSS2JSON_API_KEY)가 필요한지 확인해 보세요."
        );
      }

      allItems = mergeAndSort(batches);
      if (errors.length) {
        showError("일부 출처는 실패했어요: " + errors.join(" · "));
      }

      var now = new Date();
      els.lastUpdated.dateTime = now.toISOString();
      els.lastUpdated.textContent =
        "마지막 새로고침 " +
        new Intl.DateTimeFormat("ko-KR", {
          timeZone: "America/Toronto",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          timeZoneName: "short",
        }).format(now);

      setEditionDate();
      render();
    } catch (e) {
      showError(
        (e && e.message) ||
          "문제가 생겼어요. 이 폴더를 HTTP로 연 다음 다시 시도해 보세요."
      );
      allItems = [];
      render();
    } finally {
      setLoading(false);
    }
  }

  function clearTranslationUi() {
    document.querySelectorAll(".news-article.is-translated").forEach(function (el) {
      el.classList.remove("is-translated");
    });
    document.querySelectorAll(".article-title-ko").forEach(function (el) {
      el.textContent = "";
    });
    document.querySelectorAll(".article-body-ko").forEach(function (el) {
      el.textContent = "";
    });
    if (els.btnTranslate) {
      els.btnTranslate.textContent = "한글로 번역";
      els.btnTranslate.classList.remove("is-on");
    }
  }

  async function runTranslateAll() {
    if (!window.MarketsTranslate) {
      showError("translate.js를 불러오지 못했어요. index.html의 script 순서를 확인해 주세요.");
      return;
    }
    if (translateRunning) return;

    var articles = document.querySelectorAll(".news-article");
    if (!articles.length) return;

    if (els.btnTranslate.classList.contains("is-on")) {
      clearTranslationUi();
      updateStatusLine();
      return;
    }

    translateRunning = true;
    els.btnTranslate.disabled = true;
    var total = articles.length;
    var i;
    try {
      for (i = 0; i < total; i++) {
        var art = articles[i];
        var titleEn = art.querySelector(".article-title-en");
        var bodyEn = art.querySelector(".article-body-en");
        var titleKo = art.querySelector(".article-title-ko");
        var bodyKo = art.querySelector(".article-body-ko");
        if (!titleEn || !titleKo) continue;

        els.statusText.textContent =
          "한글 번역 중… (" + (i + 1) + "/" + total + ") — 잠시만 기다려 주세요";

        var t = titleEn.textContent || "";
        titleKo.textContent = await window.MarketsTranslate.translateChunk(t);

        if (bodyEn && bodyKo) {
          var b = bodyEn.textContent || "";
          var slice = b.length > BODY_TRANSLATE_MAX ? b.slice(0, BODY_TRANSLATE_MAX) + "…" : b;
          bodyKo.textContent = slice
            ? await window.MarketsTranslate.translateLong(slice)
            : "";
        }

        art.classList.add("is-translated");
        titleKo.setAttribute("aria-hidden", "false");
        if (bodyKo) bodyKo.setAttribute("aria-hidden", "false");
      }

      els.btnTranslate.textContent = "영어 원문으로 다시 보기";
      els.btnTranslate.classList.add("is-on");
    } catch (err) {
      showError(
        (err && err.message ? err.message : "번역 중 오류") +
          " — 잠시 후 다시 눌러 보거나, Wi-Fi를 확인해 주세요."
      );
    } finally {
      translateRunning = false;
      els.btnTranslate.disabled = false;
      updateStatusLine();
    }
  }

  els.btnRefresh.addEventListener("click", function () {
    clearTranslationUi();
    loadNews();
  });

  els.btnPrint.addEventListener("click", function () {
    window.print();
  });

  if (els.btnTranslate) {
    els.btnTranslate.addEventListener("click", function () {
      runTranslateAll();
    });
  }

  els.filterBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var f = btn.getAttribute("data-filter");
      if (!f) return;
      currentFilter = f;
      els.filterBtns.forEach(function (b) {
        b.classList.toggle("is-active", b === btn);
      });
      clearTranslationUi();
      render();
    });
  });

  els.timeBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var t = btn.getAttribute("data-time");
      if (!t) return;
      currentTimePreset = t;
      els.timeBtns.forEach(function (b) {
        b.classList.toggle("is-active", b === btn);
      });
      clearTranslationUi();
      render();
    });
  });

  setEditionDate();
  loadNews();
})();
