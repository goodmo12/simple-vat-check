/* 간이과세 배제 확인 — 순수 바닐라 JS. 빌드 도구/외부 라이브러리 없음.
 * 데이터는 fetch()가 아니라 <script> 임베드(window.TF_META / TF_JONGMOK / TF_JIYEOK)로 로드한다.
 * 이유: file:// 로 직접 열었을 때 브라우저가 fetch()의 로컬 파일 CORS를 막는 경우가 있어,
 * "브라우저에서 직접 열어도 그대로 동작해야 한다"는 요구를 만족시키기 위함.
 * 원본 data/*.json 파일은 건드리지 않고, 같은 내용을 감싼 data/*.data.js 파일을 별도로 둔다.
 */

(function () {
  "use strict";

  // 방문 측정(visit-count.js). 없거나 막혀도 도구는 그대로 동작한다. 입력값은 보내지 않는다.
  var TFA = window.TF_VISIT || { trackPageview: function () {}, trackEvent: function () {}, EVENTS: {} };
  TFA.trackPageview();

  // ---------- 0. 데이터 로드 확인 ----------
  var META = window.TF_META;
  var JONGMOK = window.TF_JONGMOK;
  var JIYEOK = window.TF_JIYEOK;

  if (!META || !JONGMOK || !JIYEOK) {
    var errBanner = document.getElementById("dataError");
    if (errBanner) errBanner.hidden = false;
    return; // 데이터 없이는 아무 것도 하지 않는다 (조용히 깨지지 않도록)
  }

  // ---------- 유틸 ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function el(html) {
    var wrap = document.createElement("div");
    wrap.innerHTML = html.trim();
    return wrap.firstElementChild;
  }

  // search_key와 동일한 규칙으로 사용자 입력을 정규화한다 (데이터 측 정규화 규칙과 반드시 일치해야 함).
  // 1) '㈜' 제거 2) NFKC 정규화 3) '(주)' 리터럴 제거 4) 괄호류 제거 5) 중점/구분자 제거 6) 공백 전부 제거 7) 소문자화
  function normQuery(s) {
    s = String(s == null ? "" : s);
    s = s.replace(/㈜/g, "");
    s = s.normalize("NFKC");
    s = s.replace(/\(주\)/g, "");
    s = s.replace(/[()\[\]]/g, "");
    s = s.replace(/[·․‧ㆍ・]/g, "");
    s = s.replace(/\s+/g, "");
    s = s.toLowerCase();
    return s;
  }

  // 표시용 한글 자간 공백 정리: "한글 1글자 + 공백 + 한글 1글자" 패턴이 연속될 때만 공백을 제거한다.
  // (예: "백 화 점" → "백화점"). 의미 있는 띄어쓰기(다글자 토큰 사이 공백)는 건드리지 않는다.
  // 확신이 안 서는 패턴은 원문 그대로 둔다(보수적 처리).
  function fixSpacedHangul(s) {
    if (!s) return s;
    var tokens = s.split(" ");
    var isSingleHangul = function (t) { return t.length === 1 && /[가-힣]/.test(t); };
    var out = [];
    var i = 0;
    while (i < tokens.length) {
      if (isSingleHangul(tokens[i])) {
        var j = i;
        var buf = "";
        while (j < tokens.length && isSingleHangul(tokens[j])) {
          buf += tokens[j];
          j++;
        }
        if (j - i >= 2) {
          out.push(buf);
        } else {
          out.push(tokens[i]);
        }
        i = j;
      } else {
        out.push(tokens[i]);
        i++;
      }
    }
    return out.join(" ");
  }

  // ---------- 1. 공통 정보 채우기 ----------
  document.getElementById("noticeLine").textContent =
    (META.notice_no || "고시번호 미상") + " · 시행일 " + (META.effective_date || "미상");

  document.getElementById("sourceLine").textContent =
    "출처: " + (META.notice_no || "") + " (시행일 " + (META.effective_date || "") + "). " +
    "이 페이지는 고시 원문을 요약·정리한 참고 자료이며 법적 효력은 원문 고시에 있습니다.";

  var art7 = document.getElementById("article7Text");
  if (art7) art7.textContent = (META.articles && META.articles["제7조"]) || "원문 없음";

  var art6 = document.getElementById("article6Text");
  if (art6) art6.textContent = (META.articles && META.articles["제6조"]) || "원문 없음";

  var excList = document.getElementById("exceptionList");
  if (excList && Array.isArray(META.jiyeok_exceptions)) {
    META.jiyeok_exceptions.forEach(function (ex) {
      var li = document.createElement("li");
      li.textContent = ex;
      excList.appendChild(li);
    });
  }

  // ---------- 2. 탭 전환 ----------
  var tabBtns = document.querySelectorAll(".tab-btn");
  tabBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      tabBtns.forEach(function (b) { b.classList.remove("active"); });
      document.querySelectorAll(".tab-panel").forEach(function (p) { p.classList.remove("active"); });
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.add("active");
    });
  });

  // ===================================================================
  // TIER 1 — 종목기준
  // ===================================================================

  var CAPITAL_CITIES = (META.jongmok_regions && META.jongmok_regions.cities) || [];

  var capitalCitySelect = document.getElementById("capitalCitySelect");
  var capitalCityPlaceholder = document.createElement("option");
  capitalCityPlaceholder.value = "";
  capitalCityPlaceholder.textContent = "시를 선택하십시오";
  capitalCitySelect.appendChild(capitalCityPlaceholder);
  CAPITAL_CITIES.forEach(function (city) {
    var opt = document.createElement("option");
    opt.value = city;
    opt.textContent = city;
    capitalCitySelect.appendChild(opt);
  });

  var regionSelect = document.getElementById("regionSelect");
  var capitalCityWrap = document.getElementById("capitalCityWrap");
  var eupmyeonWrap = document.getElementById("eupmyeonWrap");
  var eupmyeonCheck = document.getElementById("eupmyeonCheck");

  regionSelect.addEventListener("change", function () {
    var v = regionSelect.value;
    capitalCityWrap.hidden = v !== "capital17";
    eupmyeonWrap.hidden = (v !== "capital17" && v !== "gwangyeoksi");
  });

  // 종목기준 적용 지역 판정: 서울특별시 / 광역시(읍·면 제외) / 수도권 17개 시(읍·면 제외)
  function jongmokRegionQualifies() {
    var v = regionSelect.value;
    if (!v) return null; // 미선택
    if (v === "seoul") return true;
    if (v === "gwangyeoksi") return !eupmyeonCheck.checked;
    if (v === "capital17") {
      if (!capitalCitySelect.value) return null; // 시 미선택
      return !eupmyeonCheck.checked;
    }
    return false; // other
  }

  function searchJongmok(query) {
    var q = query.trim();
    if (/^\d{6}$/.test(q)) {
      return JONGMOK.filter(function (row) { return row.code === q; });
    }
    var nq = normQuery(q);
    return JONGMOK.filter(function (row) {
      return (row.search_key || "").indexOf(nq) !== -1;
    });
  }

  document.getElementById("tier1Form").addEventListener("submit", function (e) {
    e.preventDefault();
    var query = document.getElementById("jongmokQuery").value;
    var out = document.getElementById("tier1Result");
    out.innerHTML = "";

    if (!query || !query.trim()) {
      out.appendChild(el('<div class="result-msg error">검색어를 입력해 주세요.</div>'));
      return;
    }

    // 정규화 이전(raw) 값만 검사하는 위 가드는 "(", "·", "()" 같은 구두점만 입력한
    // 경우를 못 잡는다 - normQuery()가 이런 입력을 빈 문자열로 만들고
    // search_key.indexOf("")===0 이라 전건이 매칭돼 버린다(실측: 배제업종 127건
    // 전체 매칭). 6자리 코드 입력은 정규화를 거치지 않고 별도 경로로 처리되므로
    // 이 가드에서 제외한다.
    var trimmedJongmokQuery = query.trim();
    if (!/^\d{6}$/.test(trimmedJongmokQuery) && !normQuery(trimmedJongmokQuery)) {
      out.appendChild(el('<div class="result-msg error">검색어를 입력해 주세요. (문장부호만으로는 검색할 수 없습니다)</div>'));
      return;
    }

    TFA.trackEvent(TFA.EVENTS.searchJongmok);
    var matches = searchJongmok(query);
    var regionQ = jongmokRegionQualifies(); // true / false / null

    if (matches.length === 0) {
      out.appendChild(el(
        '<div class="result-msg">' +
        '"' + esc(query.trim()) + '" 은(는) <strong>배제업종 목록(127건)</strong>에서 찾을 수 없습니다.<br>' +
        '이는 "그런 업종이 없다"는 뜻이 아니라 <strong>이 목록에 없다</strong>는 뜻입니다. ' +
        '정확한 업종·업태·코드는 <a href="https://hometax.go.kr" target="_blank" rel="noopener">홈택스 업종코드 조회</a>에서 확인하십시오.<br>' +
        "혹시 건물명·지역명을 찾으시나요? ②번 탭에서 검색하십시오." +
        "</div>"
      ));
      return;
    }

    // 전체 판정 배너
    // 검색이 search_key 부분문자열 매칭이라, 짧은 검색어(예: 한 글자)는 우연히 여러 업종에
    // 매칭될 수 있다. 매칭이 2건 이상인 상태에서 확정형 배너("배제 대상에 해당할 수 있습니다")를
    // 띄우면, 사용자가 자기 업종을 특정하지도 않은 채 "나는 배제 대상"이라고 오독할 위험이 있다
    // (위험쪽 오도). 그래서 매칭이 정확히 1건일 때만 확정형을 쓰고, 2건 이상이면 "목록에서
    // 본인 업종을 먼저 확인하라"는 보류형(verdict-pending)으로 낮춘다 — 지역 판정 자체는
    // 그대로 보여주되 확정 문구만 조건부로 바꾼다.
    var matchCount = matches.length;
    var manyHint = matchCount > 20
      ? " 검색어가 짧아 결과가 많습니다. 업종명을 더 구체적으로 입력해 보십시오."
      : "";
    var verdictHtml;
    if (regionQ === null) {
      verdictHtml = '<div class="verdict verdict-pending">지역을 선택하지 않아 최종 판정을 보류합니다. 아래는 종목 매칭 결과만 보여드립니다.</div>';
    } else if (matchCount >= 2) {
      if (regionQ === true) {
        verdictHtml =
          '<div class="verdict verdict-pending">검색 결과가 ' + matchCount + '건입니다. ' +
          '<strong>귀하의 업종이 아래 목록에 있는지 먼저 확인하십시오.</strong> 해당하는 업종이 있다면, ' +
          "선택하신 지역이 종목기준 적용 지역에 해당하여 종목기준 배제 대상일 수 있습니다." + manyHint + "</div>";
      } else {
        verdictHtml =
          '<div class="verdict verdict-pending">검색 결과가 ' + matchCount + '건입니다. ' +
          '<strong>귀하의 업종이 아래 목록에 있는지 먼저 확인하십시오.</strong> 선택하신 지역은 종목기준 적용 지역' +
          "(서울특별시 / 광역시 읍·면 제외 / 수도권 17개 시 읍·면 제외)에 해당하지 않아, " +
          "해당하는 업종이 있더라도 종목기준으로는 배제되지 않습니다." + manyHint + "</div>";
      }
    } else if (regionQ === true) {
      verdictHtml =
        '<div class="verdict verdict-excluded">매칭된 업종이 배제업종 목록에 있고, 선택하신 지역이 종목기준 적용 지역에 해당하여 ' +
        '<strong>종목기준 배제 대상에 해당할 수 있습니다.</strong></div>';
    } else {
      verdictHtml =
        '<div class="verdict verdict-not-excluded">매칭된 업종이 배제업종 목록에는 있으나, 선택하신 지역은 종목기준 적용 지역' +
        '(서울특별시 / 광역시 읍·면 제외 / 수도권 17개 시 읍·면 제외)에 해당하지 않아 ' +
        '<strong>종목기준으로는 배제되지 않습니다.</strong></div>';
    }
    out.appendChild(el(verdictHtml));

    var list = document.createElement("div");
    matches.forEach(function (row) {
      list.appendChild(el(
        '<div class="card"><h3>' + esc(row["업태"]) + " · " + esc(fixSpacedHangul(row["종목"])) + '</h3>' +
        '<div class="code">업종코드: ' + esc(row.code) + "</div></div>"
      ));
    });
    out.appendChild(list);

    out.appendChild(el(
      '<p class="caution">※ 이 결과는 종목기준(제4조) 단독 판정입니다. 아래 지역기준 검색 결과와 합쳐서 ' +
      "하나의 최종 결론으로 보지 마십시오 — 제6조 적용순위 해석이 확정되어 있지 않습니다. " +
      '자세한 내용은 하단 "제6조" 안내를 참고하십시오.</p>'
    ));
  });

  // ===================================================================
  // TIER 2 — 지역기준
  // ===================================================================

  var myCodeInput = document.getElementById("myCodeInput");
  var lastTier2Rows = null; // 마지막 검색 결과 — 업종코드 입력 변경 시 재렌더용

  // 모드 전환 (건물명 검색 / 세무서 드릴다운)
  var modeBtns = document.querySelectorAll(".mode-btn");
  var nameForm = document.getElementById("tier2NameForm");
  var officeForm = document.getElementById("tier2OfficeForm");
  modeBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      modeBtns.forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      var isName = btn.dataset.mode === "name";
      nameForm.hidden = !isName;
      officeForm.hidden = isName;
      document.getElementById("tier2Result").innerHTML = "";
      lastTier2Rows = null;
    });
  });

  // 지방국세청 옵션 채우기 (등장 순서 유지, 중복 제거)
  var regionalOfficeSelect = document.getElementById("regionalOfficeSelect");
  var seenOffices = [];
  JIYEOK.forEach(function (row) {
    if (row.regional_office && seenOffices.indexOf(row.regional_office) === -1) {
      seenOffices.push(row.regional_office);
    }
  });
  seenOffices.forEach(function (office) {
    var opt = document.createElement("option");
    opt.value = office;
    opt.textContent = office;
    regionalOfficeSelect.appendChild(opt);
  });

  var taxOfficeSelect = document.getElementById("taxOfficeSelect");

  regionalOfficeSelect.addEventListener("change", function () {
    var office = regionalOfficeSelect.value;
    taxOfficeSelect.innerHTML = "";
    if (!office) {
      taxOfficeSelect.disabled = true;
      taxOfficeSelect.appendChild(el('<option value="">지방국세청을 먼저 선택하십시오</option>'));
      document.getElementById("tier2Result").innerHTML = "";
      return;
    }
    taxOfficeSelect.disabled = false;
    taxOfficeSelect.appendChild(el('<option value="">세무서를 선택하십시오</option>'));
    var seenTax = [];
    JIYEOK.forEach(function (row) {
      if (row.regional_office === office && row.tax_office && seenTax.indexOf(row.tax_office) === -1) {
        seenTax.push(row.tax_office);
      }
    });
    seenTax.forEach(function (tax) {
      var opt = document.createElement("option");
      opt.value = tax;
      opt.textContent = tax;
      taxOfficeSelect.appendChild(opt);
    });
    document.getElementById("tier2Result").innerHTML = "";
  });

  taxOfficeSelect.addEventListener("change", function () {
    var office = regionalOfficeSelect.value;
    var tax = taxOfficeSelect.value;
    if (!office || !tax) {
      document.getElementById("tier2Result").innerHTML = "";
      lastTier2Rows = null;
      return;
    }
    TFA.trackEvent(TFA.EVENTS.pickOffice);
    var rows = JIYEOK.filter(function (r) { return r.regional_office === office && r.tax_office === tax; });
    renderTier2Rows(rows, { emptyMsg: "해당 세무서의 지역기준 데이터가 없습니다." });
  });

  document.getElementById("tier2NameForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var query = document.getElementById("nameQuery").value;
    var out = document.getElementById("tier2Result");
    if (!query || !query.trim()) {
      out.innerHTML = "";
      out.appendChild(el('<div class="result-msg error">검색어를 입력해 주세요.</div>'));
      lastTier2Rows = null;
      return;
    }
    var nq = normQuery(query);
    if (!nq) {
      // 구두점만 입력한 경우(normQuery가 빈 문자열을 반환) indexOf("")===0 으로
      // 전건이 매칭되는 것을 막는다(실측: 지역기준 647건 전체 매칭).
      out.innerHTML = "";
      out.appendChild(el('<div class="result-msg error">검색어를 입력해 주세요. (문장부호만으로는 검색할 수 없습니다)</div>'));
      lastTier2Rows = null;
      return;
    }
    TFA.trackEvent(TFA.EVENTS.searchName);
    var rows = JIYEOK.filter(function (row) {
      return (row.search_key || "").indexOf(nq) !== -1;
    });
    renderTier2Rows(rows, {
      emptyMsg:
        '"' + esc(query.trim()) + '" 이(가) 포함된 건물명·지역명을 별표4 지역기준 목록에서 찾을 수 없습니다. ' +
        "다른 표기(예: 동 이름, 상가명 축약형)로 다시 검색해 보십시오.<br>" +
        "혹시 업종을 찾으시나요? ①번 탭에서 검색하십시오."
    });
  });

  myCodeInput.addEventListener("input", function () {
    if (lastTier2Rows) renderTier2Rows(lastTier2Rows, { keepStored: true });
  });

  function myCode() {
    var v = myCodeInput.value.trim();
    return /^\d{6}$/.test(v) ? v : null;
  }

  function renderTier2Rows(rows, opts) {
    opts = opts || {};
    if (!opts.keepStored) lastTier2Rows = rows;
    var out = document.getElementById("tier2Result");
    out.innerHTML = "";

    if (!rows || rows.length === 0) {
      out.appendChild(el('<div class="result-msg">' + (opts.emptyMsg || "검색 결과가 없습니다.") + "</div>"));
      return;
    }

    var code = myCode();
    var myCodeRaw = myCodeInput.value.trim();
    if (myCodeRaw && !code) {
      out.appendChild(el('<div class="result-msg">업종코드는 숫자 6자리로 입력하시면 제외업종 대조가 가능합니다.</div>'));
    }

    rows.forEach(function (row, idx) {
      var card = document.createElement("div");
      card.className = "card";

      var badges = "";
      if (row.row_parse_ok === false) {
        badges += '<span class="badge err">원문 확인 필요(자동 추출 불완전)</span>';
      }
      if (row.names_addresses_count_mismatch) {
        badges += '<span class="badge warn">이름·소재지 순서 불일치 가능</span>';
      }
      if (row.has_area_condition || row.has_rent_condition) {
        badges += '<span class="badge warn">면적·월세 조건부 지역</span>';
      }

      var namesHtml = (row.names || []).filter(function (n) { return n && n.trim(); })
        .map(function (n) { return "<li>" + esc(n.trim()) + "</li>"; }).join("");
      var addrHtml = (row.addresses || []).filter(function (a) { return a && a.trim(); })
        .map(function (a) { return "<li>" + esc(a.trim()) + "</li>"; }).join("");

      var html =
        '<h3>' + esc(row.regional_office) + " · " + esc(row.tax_office) +
        ' <span class="badge no">' + esc(row.category) + "</span></h3>" +
        '<div>' + badges + "</div>";

      if (row.row_parse_ok === false) {
        html +=
          '<p class="caution">이 행은 고시 원문에서 자동 추출이 불완전했습니다. ' +
          "아래 내용을 참고용으로만 보시고, 반드시 고시 원문 별표4를 직접 대조하십시오.</p>";
      }

      html += "<p><strong>이름 목록</strong> (건물·상가·동 이름 등)</p>";
      html += namesHtml ? '<ul class="list-inline">' + namesHtml + "</ul>" : "<p>(이름 목록 없음)</p>";
      html += "<p><strong>소재지 목록</strong></p>";
      html += addrHtml ? '<ul class="list-inline">' + addrHtml + "</ul>" : "<p>(소재지 목록 없음)</p>";
      html +=
        '<p class="caution">※ 위 이름 목록과 소재지 목록은 행 단위로 각각 표시됩니다. ' +
        "원문 표의 줄바꿈 구조상 이름과 소재지가 순서대로 1:1 대응하지 않을 수 있어, " +
        "억지로 짝을 지어 보여드리지 않습니다. 정확한 대응은 아래 원문(scope_raw) 및 고시 별표4를 직접 확인하십시오.</p>";

      html += "<p><strong>적용범위 원문</strong></p>";
      html += '<div class="raw-block">' + esc(row.scope_raw || "(원문 없음)") + "</div>";

      if (row.has_area_condition || row.has_rent_condition) {
        var fid = "areaRent_" + idx + "_" + Math.random().toString(36).slice(2, 7);
        html +=
          '<div class="field-row">' +
          '<label>사업장 면적(㎡)<input type="number" min="0" step="0.1" data-role="area" id="' + fid + '_a"></label>' +
          '<label>월세(만원)<input type="number" min="0" step="0.1" data-role="rent" id="' + fid + '_r"></label>' +
          "</div>" +
          '<p class="caution" data-role="areaRentStatus">확인 필요 — 면적·월세를 입력하지 않으면 판정을 확정할 수 없습니다. ' +
          "위 적용범위 원문에 있는 면적·월세 조건과 입력값을 직접 대조하십시오. " +
          "이 도구는 원문이 자유 서술 형식이라 조건을 자동으로 계산하지 않습니다(의도적 생략).</p>";
      }

      var polarity = row.scope_code_polarity;
      if (polarity === "unknown") {
        // 코드 목록의 의미(포함 vs 배제)를 자동으로 판별하지 못한 행 — 추측해서 보여주지 않는다.
        html +=
          '<p class="caution">적용범위의 업종 조건을 자동 판별하지 못했습니다. 위 적용범위 원문을 직접 확인하십시오.</p>';
      } else {
        var isExclude = polarity === "exclude";
        var codeList = isExclude ? row.excluded_codes : row.included_codes;
        var listLabel = isExclude ? "이 지역 적용범위에서 제외되는 업종코드" : "이 지역에서 배제 대상이 되는 업종코드";

        if (codeList && codeList.length) {
          html += "<p><strong>" + listLabel + "</strong>: " + codeList.map(esc).join(", ") + "</p>";
        }
        if (row.codes_partial) {
          html += '<p class="caution">이 목록은 완전하지 않을 수 있습니다. 원문을 함께 확인하십시오.</p>';
        }
        if (row.code_ranges && row.code_ranges.length) {
          html += "<p><strong>범위로 지정된 코드</strong>: " + row.code_ranges.map(esc).join(", ") + "</p>";
        }

        // 범위 표기(예: "552101∼552104")를 개별 코드로 전개하지 않고, 사용자가 입력한 코드가
        // 그 범위 안에 드는지만 참고용으로 판정한다. 구분자는 여러 종류가 관측된다(∼ ～ 〜).
        // 앞뒤가 6자리 숫자가 아닌 변칙 표기(예: "552～")는 대조 대상에서 제외한다 — 억지로 해석하지 않는다.
        var parsedRanges = [];
        (row.code_ranges || []).forEach(function (raw) {
          var m = /^(\d{6})\s*[∼～〜~-]\s*(\d{6})$/.exec(raw);
          if (m) {
            parsedRanges.push({ raw: raw, start: parseInt(m[1], 10), end: parseInt(m[2], 10) });
          }
        });

        var exactHit = code && codeList && codeList.indexOf(code) !== -1;
        var rangeHits = [];
        if (code && !exactHit) {
          var codeNum = parseInt(code, 10);
          parsedRanges.forEach(function (r) {
            if (codeNum >= r.start && codeNum <= r.end) rangeHits.push(r);
          });
        }

        if (exactHit) {
          // 1) 개별 목록에 정확히 일치
          html += isExclude
            ? ('<p class="caution">입력하신 업종코드(' + esc(code) + ')가 위 제외 목록에 있습니다. ' +
               "이 지역이라도 귀하의 업종은 지역기준 적용범위에서 제외될 수 있습니다. 원문과 직접 대조하십시오.</p>")
            : ('<p class="caution">입력하신 업종코드(' + esc(code) + ')가 위 목록에 있습니다. ' +
               "귀하의 업종이 이 지역의 배제 대상에 해당할 수 있습니다(원문 확인 필요).</p>");
        } else if (rangeHits.length) {
          // 2) 개별 목록엔 없지만 범위 표기 안에 들어감 — 확정하지 않고 원문 확인으로 넘긴다.
          var rangeListStr = rangeHits.map(function (r) { return esc(r.raw); }).join(", ");
          html += isExclude
            ? ('<p class="caution">입력하신 업종코드(' + esc(code) + ')가 범위 표기 <strong>' + rangeListStr +
               '</strong> 안에 들어갑니다. 이 범위에 실제로 해당하는지는 확정할 수 없습니다 — 업종코드가 연속 숫자라고 해서 ' +
               '그 사이 코드가 전부 실재하거나 전부 이 제외 범위에 해당한다는 보장이 없습니다. ' +
               '이 지역이라도 귀하의 업종이 제외 범위에 들어갈 수 있습니다. 아래 적용범위 원문을 직접 확인하십시오.</p>')
            : ('<p class="caution">입력하신 업종코드(' + esc(code) + ')가 범위 표기 <strong>' + rangeListStr +
               '</strong> 안에 들어갑니다. 이 범위에 실제로 해당하는지는 확정할 수 없습니다 — 업종코드가 연속 숫자라고 해서 ' +
               '그 사이 코드가 전부 실재하거나 전부 이 배제 대상 범위에 해당한다는 보장이 없습니다. ' +
               '귀하의 업종이 배제 대상 범위에 들어갈 수 있습니다. 아래 적용범위 원문을 직접 확인하십시오.</p>');
          if (row.has_area_condition || row.has_rent_condition) {
            html += '<p class="caution">이 행에는 <strong>사업장 면적·월세 조건</strong>도 함께 걸려 있습니다. 범위에 들어가더라도 그 조건까지 확인해야 합니다.</p>';
          }
        } else if (row.code_ranges && row.code_ranges.length) {
          // 3) 둘 다 아님(또는 코드 미입력) — 범위 표기가 있으니 자동 대조가 완전하지 않을 수 있음을 알린다.
          html += '<p class="caution">범위로 지정된 코드가 있어 자동 대조되지 않을 수 있습니다. 원문을 확인하십시오.</p>';
        }
      }

      card.innerHTML = html;
      out.appendChild(card);

      if (row.has_area_condition || row.has_rent_condition) {
        var statusEl = card.querySelector('[data-role="areaRentStatus"]');
        var areaEl = card.querySelector('[data-role="area"]');
        var rentEl = card.querySelector('[data-role="rent"]');
        function updateStatus() {
          if (areaEl.value.trim() || rentEl.value.trim()) {
            statusEl.textContent =
              "확인 필요 — 입력하신 값(면적 " + (areaEl.value || "미입력") + "㎡, 월세 " +
              (rentEl.value || "미입력") + "만원)을 위 적용범위 원문과 직접 대조하십시오. " +
              "이 도구는 자유 서술 형식 원문을 자동으로 판정하지 않습니다.";
          } else {
            statusEl.textContent =
              "확인 필요 — 면적·월세를 입력하지 않으면 판정을 확정할 수 없습니다. " +
              "위 적용범위 원문에 있는 면적·월세 조건과 입력값을 직접 대조하십시오.";
          }
        }
        areaEl.addEventListener("input", updateStatus);
        rentEl.addEventListener("input", updateStatus);
      }
    });

    out.appendChild(el(
      '<p class="caution">※ 이 결과는 지역기준(제5조) 단독 판정입니다. 상단 ①번 종목기준 결과와 합쳐서 ' +
      '하나의 최종 결론으로 보지 마십시오. 제5조 예외 4종에 해당하는 사업자는 지역기준에도 불구하고 ' +
      "간이과세가 적용될 수 있습니다 — 하단 안내를 확인하십시오.</p>"
    ));
  }
})();
