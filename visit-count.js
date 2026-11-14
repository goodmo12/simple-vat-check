/* 방문·버튼 사용 횟수 측정 (GoatCounter). 외부 스크립트 없이 문서화된 /count 픽셀(GET)을 직접 부른다.
 * 근거: https://www.goatcounter.com/help/pixel  (p=경로/이벤트명, t=제목, r=리퍼러, e=이벤트, q=캠페인용 쿼리)
 *       https://www.goatcounter.com/help/campaigns (utm_campaign / utm_source 등을 쿼리에서 자동 인식)
 * 원칙: 코드가 비었거나 배포 주소가 아니면 아무것도 안 보낸다. 사용자 입력(검색어·업종·주소 등)은 절대 보내지 않는다.
 *       이벤트 이름은 아래 고정 목록만. 전송 실패는 삼키고, 화면·버튼 동작에 영향 없다.
 * 이 파일은 도구별 복사본이다(다른 도구와 공유하지 않는다).
 * 브라우저에서는 classic <script> 로 읽어 window.TF_VISIT 를 만들고, Node 테스트는 require 로 읽는다.
 */
(function (root) {
  "use strict";

  var GOATCOUNTER_CODE = "secondbranch"; // 예: "mycode" -> https://mycode.goatcounter.com/count. 비어 있으면 no-op.
  var COUNT_HOST = "secondbranch.kr"; // 이 호스트에서만 전송(로컬·미리보기 소음 차단)

  var EVENTS = Object.freeze({
    searchJongmok: "vat-check-search-jongmok", // ① 업종 검색 실행
    searchName: "vat-check-search-name",       // ② 건물명·지역명 검색 실행
    pickOffice: "vat-check-pick-office",       // ② 세무서 드릴다운 선택 완료
    firstUse: "vat-check-first-use"            // 위 3개 중 무엇이든 이 방문에서 처음 쓴 순간 1회
  });
  var ALLOWED = Object.keys(EVENTS).map(function (k) { return EVENTS[k]; });

  // 캠페인용 쿼리 문자열. GoatCounter 가 실제로 쓰는 utm_source·utm_campaign 두 개만, 값은 100자로 자른다.
  function campaignQuery(search) {
    try {
      var params = new URLSearchParams(search || "");
      var out = new URLSearchParams();
      ["utm_source", "utm_campaign"].forEach(function (k) {
        if (params.has(k)) out.append(k, params.get(k).slice(0, 100));
      });
      return out.toString();
    } catch (e) {
      return "";
    }
  }

  // 리퍼러는 origin + pathname 으로 자른다(쿼리·해시 버림). 파싱 실패면 "".
  function trimReferrer(ref) {
    try {
      var u = new URL(ref);
      return u.origin === "null" ? "" : u.origin + u.pathname;
    } catch (e) {
      return "";
    }
  }

  function countUrl(code, params) {
    var u = new URLSearchParams();
    Object.keys(params).forEach(function (k) { if (params[k]) u.set(k, params[k]); });
    u.set("rnd", Math.random().toString(36).slice(2, 8)); // 캐시 방지(문서상 무시되는 값)
    return "https://" + code + ".goatcounter.com/count?" + u.toString();
  }

  function defaultSend(url) { new Image().src = url; }


  function active(env) {
    var code = env.code !== undefined ? env.code : GOATCOUNTER_CODE;
    if (!code || !/^[a-z0-9-]+$/i.test(code)) return null;
    if (!env.location || env.location.hostname !== COUNT_HOST) return null;
    return code;
  }

  function withDefaults(env, withDoc) {
    var e = { location: root.location };
    if (withDoc && root.document) { e.referrer = root.document.referrer; e.title = root.document.title; }
    for (var k in env) e[k] = env[k];
    return e;
  }

  // 방문 1회. env 는 테스트 주입용: { code, location, referrer, title, send }
  function trackPageview(env) {
    try {
      var e = withDefaults(env || {}, true);
      var code = active(e);
      if (!code) return;
      (e.send || defaultSend)(countUrl(code, {
        p: e.location.pathname, t: e.title, r: trimReferrer(e.referrer), q: campaignQuery(e.location.search)
      }));
    } catch (err) { /* 측정 실패는 무시 */ }
  }

  // 버튼 사용 1회. 고정 목록 밖의 이름은 버린다.
  function trackEvent(name, env) {
    try {
      if (ALLOWED.indexOf(name) === -1) return;
      var e = withDefaults(env || {}, false);
      var code = active(e);
      if (!code) return;
      (e.send || defaultSend)(countUrl(code, { p: name, t: name, e: "1" }));
    } catch (err) { /* 측정 실패는 무시 */ }
  }

  // 사용 행동 1회를 센다: 해당 이벤트를 보내고, 이 추적기에서 처음이면 firstUse 도 1번 보낸다.
  // 추적기는 페이지 로드마다 하나 만든다(app.js). 입력값은 받지 않는다 — 이벤트 이름만.
  function makeUseTracker() {
    var firstSent = false;
    return function trackUse(name, env) {
      trackEvent(name, env);
      if (!firstSent) {
        firstSent = true;
        trackEvent(EVENTS.firstUse, env);
      }
    };
  }

  var api = {
    GOATCOUNTER_CODE: GOATCOUNTER_CODE, EVENTS: EVENTS,
    campaignQuery: campaignQuery, trimReferrer: trimReferrer, trackPageview: trackPageview, trackEvent: trackEvent, makeUseTracker: makeUseTracker
  };
  root.TF_VISIT = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
