(function () {
  "use strict";

  const SERVICE_MANAGER_ORIGIN = "https://servicemanager.kcac.ca";
  const CHURCH_TIME_ZONE = "America/Toronto";
  const ANNOUNCEMENT_PREVIEW_PAGE_SIZE = 6;
  const ANNOUNCEMENT_PAGE_SIZE = 25;
  let countdownTimer = null;

  function ready(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback);
      return;
    }

    callback();
  }

  ready(function () {
    loadServiceManagerData().catch(function (error) {
      console.error("Unable to load ServiceManager data", error);
      renderServiceManagerError();
    });
  });

  async function loadServiceManagerData() {
    const needsLive = hasAnyElement([
      "comboService",
      "serviceTitle",
      "countdown",
      "serviceOverview",
      "peopleTableBody",
      "contactDetails",
      "upcomingServices",
      "pastServicesList",
    ]);
    const needsBase = hasAnyElement(["churchMotto", "fellowshipList"]);
    const needsAnnouncementPreview = hasAnyElement(["announcementList"]);
    const needsAnnouncementPage = hasAnyElement(["announcementPageList"]);
    const announcementPage = currentPageNumber();

    const liveRequest = needsLive
      ? fetchJson("/api/v1/live").catch(function (error) {
          return { error: error };
        })
      : Promise.resolve(null);
    const baseRequest = needsBase
      ? fetchJson("/api/v1/base").catch(function (error) {
          return { error: error };
        })
      : Promise.resolve(null);
    const announcementPreviewRequest = needsAnnouncementPreview
      ? fetchJson(announcementEndpoint(1, ANNOUNCEMENT_PREVIEW_PAGE_SIZE)).catch(function (error) {
          return { error: error };
        })
      : Promise.resolve(null);
    const announcementPageRequest = needsAnnouncementPage
      ? fetchJson(announcementEndpoint(announcementPage, ANNOUNCEMENT_PAGE_SIZE)).catch(function (error) {
          return { error: error };
        })
      : Promise.resolve(null);

    const results = await Promise.all([liveRequest, baseRequest, announcementPreviewRequest, announcementPageRequest]);
    const live = results[0];
    const base = results[1];
    const announcementPreview = results[2];
    const announcementPageData = results[3];

    if (live && !live.error) {
      renderLiveData(live);
    } else if (live && live.error) {
      console.error("ServiceManager live API failed", live.error);
      renderLiveError();
    }

    if (base && !base.error) {
      renderBaseData(base.data || {});
      if (!live || live.error) {
        renderChurchProfile(base.data && base.data.churchProfile);
      }
    } else if (base && base.error) {
      console.error("ServiceManager base API failed", base.error);
      renderBaseError();
    }

    if (announcementPreview && !announcementPreview.error) {
      renderAnnouncementPreview(announcementPreview);
    } else if (announcementPreview && announcementPreview.error) {
      console.error("ServiceManager announcement preview API failed", announcementPreview.error);
      renderAnnouncementError();
    }

    if (announcementPageData && !announcementPageData.error) {
      renderAnnouncementPage(announcementPageData);
    } else if (announcementPageData && announcementPageData.error) {
      console.error("ServiceManager announcements page API failed", announcementPageData.error);
      renderAnnouncementPageError();
    }
  }

  async function fetchJson(path) {
    const response = await fetch(SERVICE_MANAGER_ORIGIN + path, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(path + " returned " + response.status);
    }

    return response.json();
  }

  function announcementEndpoint(page, pageSize) {
    const params = new URLSearchParams({
      date: currentChurchDate(),
      page: String(page),
      pageSize: String(pageSize),
    });
    return "/api/v1/announcements?" + params.toString();
  }

  function renderLiveData(data) {
    renderCountdown(data);
    renderChurchProfile(data.churchInfo);
    renderUpcomingServices(data.services);
    renderPastServices(data.services);
  }

  function renderBaseData(data) {
    renderMotto(data.churchProfile);
    renderFellowships(data.fellowships);
  }

  function renderChurchProfile(profile) {
    if (!profile) {
      return;
    }

    renderMeetingOverview(profile.meetingOverview);
    renderPeople(profile.directoryEntries);
    renderContact(profile);
  }

  function renderCountdown(data) {
    const titleElement = byId("serviceTitle");
    const countdownElement = byId("countdown");
    const comboElement = byId("comboService");

    if (!titleElement && !countdownElement && !comboElement) {
      return;
    }

    const services = data.services || {};
    const current = Array.isArray(services.current) ? services.current[0] : null;
    const service = current || services.next || null;

    if (!service) {
      setText(titleElement, "No upcoming service available");
      setText(countdownElement, "");
      setText(comboElement, "");
      return;
    }

    setText(titleElement, service.title || "Sunday Service");
    updateServiceNotice(comboElement, service, Boolean(current));

    if (countdownTimer) {
      window.clearInterval(countdownTimer);
    }

    const update = function () {
      updateCountdownText(countdownElement, service);
    };

    update();
    countdownTimer = window.setInterval(update, 1000);
  }

  function updateCountdownText(element, service) {
    if (!element) {
      return;
    }

    const now = Date.now();
    const start = Date.parse(service.startAt || "");
    const end = Date.parse(service.endAt || "");

    if (Number.isFinite(start) && Number.isFinite(end) && now >= start && now < end) {
      element.textContent = "Our service is now live";
      return;
    }

    if (!Number.isFinite(start)) {
      element.textContent = "";
      return;
    }

    const difference = start - now;
    if (difference <= 0) {
      element.textContent = "";
      window.clearInterval(countdownTimer);
      countdownTimer = null;
      loadServiceManagerData().catch(function (error) {
        console.error("Unable to refresh ServiceManager data", error);
      });
      return;
    }

    const days = Math.floor(difference / 86400000);
    const hours = Math.floor((difference % 86400000) / 3600000);
    const minutes = Math.floor((difference % 3600000) / 60000);
    element.textContent = days + " Days, " + hours + " Hours, " + minutes + " Minutes";
  }

  function updateServiceNotice(element, service, isLive) {
    if (!element) {
      return;
    }

    if (isLive || service.isLive) {
      element.textContent = "Our service is now live 我們現在正在進行崇拜";
      return;
    }

    if (isCombinedOrSpecial(service)) {
      const time = service.serviceTimeLabel || formatServiceTime(service.serviceTime);
      element.textContent = "Please note: " + (service.title || "the next service") + " starts at " + time + ". 請注意下次崇拜時間。";
      return;
    }

    element.textContent = "";
  }

  function renderMeetingOverview(rows) {
    const body = byId("serviceOverview");
    if (!body) {
      return;
    }

    clear(body);
    const meetings = array(rows).filter(function (row) {
      return [row.name, row.note, row.schedule, row.location, row.extra].some(hasText);
    });

    if (!meetings.length) {
      appendTableMessage(body, 2, "No service information available.");
      return;
    }

    meetings.forEach(function (meeting) {
      const row = document.createElement("tr");
      const nameCell = document.createElement("td");
      const detailCell = document.createElement("td");
      const name = document.createElement("strong");

      name.textContent = text(meeting.name);
      nameCell.appendChild(name);
      appendLines(detailCell, [meeting.schedule, meeting.location, meeting.note, meeting.extra]);
      row.appendChild(nameCell);
      row.appendChild(detailCell);
      body.appendChild(row);
    });
  }

  function renderPeople(rows) {
    const body = byId("peopleTableBody");
    if (!body) {
      return;
    }

    clear(body);
    const people = array(rows).filter(function (row) {
      return [row.roleEn, row.roleZh, row.name].some(hasText);
    });

    if (!people.length) {
      appendTableMessage(body, 2, "No people information available.");
      return;
    }

    people.forEach(function (person) {
      const row = document.createElement("tr");
      const roleCell = document.createElement("td");
      const nameCell = document.createElement("td");

      appendLines(roleCell, [person.roleEn, person.roleZh]);
      nameCell.textContent = text(person.name);
      row.appendChild(roleCell);
      row.appendChild(nameCell);
      body.appendChild(row);
    });
  }

  function renderContact(profile) {
    const container = byId("contactDetails");
    if (!container) {
      return;
    }

    clear(container);
    const phone = text(profile.phoneNumber);
    const addressLines = array(profile.addressLines)
      .map(text)
      .filter(Boolean)
      .filter(function (line) {
        return !phone || line !== phone;
      });
    const emailLines = unique([profile.email].concat(array(profile.contactLines)).map(text).filter(Boolean));

    if (addressLines.length) {
      container.appendChild(document.createTextNode("Address: "));
      const link = document.createElement("a");
      link.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(addressLines.join(", "));
      link.textContent = addressLines.join(", ");
      container.appendChild(link);
      container.appendChild(document.createElement("br"));
    }

    if (phone) {
      container.appendChild(document.createTextNode("Phone: " + phone));
      container.appendChild(document.createElement("br"));
    }

    if (emailLines.length) {
      container.appendChild(document.createTextNode("Email: "));
      emailLines.forEach(function (email, index) {
        if (index > 0) {
          container.appendChild(document.createTextNode(", "));
        }
        const link = document.createElement("a");
        link.href = "mailto:" + email;
        link.textContent = email;
        container.appendChild(link);
      });
      container.appendChild(document.createElement("br"));
    }

    if (!container.childNodes.length) {
      container.textContent = "Contact information is not available.";
    }
  }

  function renderUpcomingServices(services) {
    const body = byId("upcomingServices");
    if (!body) {
      return;
    }

    clear(body);
    const items = uniqueServices(
      array(services && services.current)
        .concat(services && services.next ? [services.next] : [])
        .concat(array(services && services.upcoming)),
    );

    if (!items.length) {
      appendTableMessage(body, 1, "No upcoming services available.");
      return;
    }

    items.forEach(function (service) {
      const row = document.createElement("tr");
      const dateCell = document.createElement("td");
      const serviceCell = document.createElement("td");
      const actionCell = document.createElement("td");
      const title = document.createElement("strong");

      appendLines(dateCell, [formatServiceDate(service), service.serviceTimeLabel || formatServiceTime(service.serviceTime)]);
      title.textContent = service.title || "Sunday Service";
      serviceCell.appendChild(title);
      if (service.isLive) {
        serviceCell.appendChild(document.createElement("br"));
        serviceCell.appendChild(document.createTextNode("Live now"));
      }

      const link = document.createElement("a");
      link.className = "button";
      link.href = service.youtubeWatchUrl || "https://live.kcac.ca";
      link.textContent = service.youtubeWatchUrl ? "Watch" : "Live";
      actionCell.appendChild(link);

      row.appendChild(dateCell);
      row.appendChild(serviceCell);
      row.appendChild(actionCell);
      body.appendChild(row);
    });
  }

  function renderPastServices(services) {
    const list = byId("pastServicesList");
    if (!list) {
      return;
    }

    clear(list);
    const items = array(services && services.previous).filter(function (service) {
      return service && service.youtubeWatchUrl;
    });

    if (!items.length) {
      list.appendChild(contentSection("No previous service videos are available.", ["Please check back after the next livestream."]));
      return;
    }

    items.forEach(function (service) {
      const details = [
        [formatServiceDate(service), service.serviceTimeLabel || formatServiceTime(service.serviceTime)].filter(Boolean).join(" "),
        serviceKindLabel(service.serviceKind),
        labeledText("Speaker", servicePersonnelValue(service, "講員")),
      ].filter(Boolean);
      list.appendChild(contentSection(service.title || "Sunday Service", details, service.youtubeWatchUrl, "Watch Service 回看崇拜"));
    });
  }

  function renderAnnouncementPreview(data) {
    const list = byId("announcementList");
    if (!list) {
      return;
    }

    renderAnnouncementCards(list, data && data.items);
    renderAnnouncementMeta(byId("announcementListMeta"), data, "Showing current announcements");
  }

  function renderAnnouncementPage(data) {
    const list = byId("announcementPageList");
    if (!list) {
      return;
    }

    renderAnnouncementCards(list, data && data.items);
    renderAnnouncementMeta(byId("announcementPageMeta"), data, "Current announcements");
    renderAnnouncementPagination(data);
  }

  function renderAnnouncementCards(list, rows) {
    clear(list);
    const announcements = array(rows).filter(function (row) {
      return [row.title, row.body].some(hasText);
    });

    if (!announcements.length) {
      list.appendChild(contentSection("No current announcements.", ["目前沒有公告。"]));
      return;
    }

    announcements.forEach(function (announcement) {
      const details = [];
      const eventText = formatAnnouncementEvent(announcement);
      if (eventText) {
        details.push(eventText);
      }

      text(announcement.body).split(/\r?\n/).map(text).filter(Boolean).forEach(function (line) {
        details.push(line);
      });

      list.appendChild(contentSection(text(announcement.title) || "Announcement", details));
    });
  }

  function renderAnnouncementMeta(element, data, label) {
    if (!element || !data) {
      return;
    }

    const total = Number(data.totalCount) || 0;
    const page = Number(data.page) || 1;
    const pageSize = Number(data.pageSize) || ANNOUNCEMENT_PAGE_SIZE;
    const count = Number(data.count) || array(data.items).length;

    if (!total) {
      element.textContent = "";
      return;
    }

    const start = (page - 1) * pageSize + 1;
    const end = Math.min(total, start + count - 1);
    element.textContent = label + " " + start + "-" + end + " of " + total + ".";
  }

  function renderAnnouncementPagination(data) {
    const controls = byId("announcementPagination");
    if (!controls || !data) {
      return;
    }

    clear(controls);
    const page = Number(data.page) || 1;
    const pageCount = Number(data.pageCount) || 1;

    if (pageCount <= 1) {
      return;
    }

    appendPaginationLink(controls, "First", 1, page <= 1);
    appendPaginationLink(controls, "Previous", page - 1, page <= 1);
    appendPaginationText(controls, "Page " + page + " of " + pageCount);
    appendPaginationLink(controls, "Next", page + 1, page >= pageCount);
    appendPaginationLink(controls, "Last", pageCount, page >= pageCount);
  }

  function renderMotto(profile) {
    const element = byId("churchMotto");
    if (!element || !profile) {
      return;
    }

    const lines = array(profile.yearlyMottoZhLines).map(text).filter(Boolean)
      .concat(array(profile.yearlyMottoEnLines).map(text).filter(Boolean));

    if (!lines.length) {
      return;
    }

    clear(element);
    appendLines(element, lines);
  }

  function renderFellowships(rows) {
    const list = byId("fellowshipList");
    if (!list) {
      return;
    }

    clear(list);
    const fellowships = array(rows).filter(function (row) {
      return [row.name, row.leader, row.location, row.time, row.contact].some(hasText);
    });

    if (!fellowships.length) {
      list.appendChild(fellowshipSection("No fellowships available.", []));
      return;
    }

    fellowships.forEach(function (fellowship) {
      const details = [
        labeledText("Time", fellowship.time),
        labeledText("Location", fellowship.location),
        labeledText("Leader", fellowship.leader),
        labeledText("Contact", fellowship.contact),
      ].filter(Boolean);
      list.appendChild(fellowshipSection(text(fellowship.name), details));
    });
  }

  function fellowshipSection(title, details) {
    return contentSection(title, details, "https://kcac.ca/#contactus", "Contact Us 联系我们");
  }

  function contentSection(title, details, linkHref, linkText) {
    const section = document.createElement("section");
    const inner = document.createElement("div");
    const heading = document.createElement("h3");
    const paragraph = document.createElement("p");

    inner.className = "inner";
    heading.textContent = title;
    details.forEach(function (detail, index) {
      if (index > 0) {
        paragraph.appendChild(document.createElement("br"));
      }
      paragraph.appendChild(document.createTextNode(detail));
    });

    if (linkHref && linkText) {
      if (paragraph.childNodes.length) {
        paragraph.appendChild(document.createElement("br"));
        paragraph.appendChild(document.createElement("br"));
      }
      const link = document.createElement("a");
      link.className = "button";
      link.href = linkHref;
      link.target = linkHref.indexOf("http") === 0 ? "_blank" : "";
      link.rel = linkHref.indexOf("http") === 0 ? "noopener noreferrer" : "";
      link.textContent = linkText;
      paragraph.appendChild(link);
    }

    inner.appendChild(heading);
    inner.appendChild(paragraph);
    section.appendChild(inner);
    return section;
  }

  function renderServiceManagerError() {
    renderLiveError();
    renderBaseError();
    renderAnnouncementError();
    renderAnnouncementPageError();
  }

  function renderLiveError() {
    appendTableMessage(byId("serviceOverview"), 2, "Service information is temporarily unavailable.");
    appendTableMessage(byId("peopleTableBody"), 2, "People information is temporarily unavailable.");
    appendTableMessage(byId("upcomingServices"), 1, "Upcoming services are temporarily unavailable.");
    setText(byId("serviceTitle"), "Service information unavailable");
    setText(byId("countdown"), "");
    setText(byId("comboService"), "");
    setText(byId("contactDetails"), "Contact information is temporarily unavailable.");
  }

  function renderBaseError() {
    const list = byId("fellowshipList");
    if (list) {
      clear(list);
      list.appendChild(fellowshipSection("Fellowship information is temporarily unavailable.", []));
    }
  }

  function renderAnnouncementError() {
    const list = byId("announcementList");
    if (list) {
      clear(list);
      list.appendChild(contentSection("Announcements are temporarily unavailable.", ["Please check again later."]));
    }
  }

  function renderAnnouncementPageError() {
    const list = byId("announcementPageList");
    if (list) {
      clear(list);
      list.appendChild(contentSection("Announcements are temporarily unavailable.", ["Please check again later."]));
    }
    setText(byId("announcementPageMeta"), "");
    clear(byId("announcementPagination"));
  }

  function appendTableMessage(body, colSpan, message) {
    if (!body) {
      return;
    }

    clear(body);
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = colSpan;
    cell.textContent = message;
    row.appendChild(cell);
    body.appendChild(row);
  }

  function appendLines(element, values) {
    values.map(text).filter(Boolean).forEach(function (value, index) {
      if (index > 0) {
        element.appendChild(document.createElement("br"));
      }
      element.appendChild(document.createTextNode(value));
    });
  }

  function labeledText(label, value) {
    const cleanValue = text(value);
    return cleanValue ? label + ": " + cleanValue : "";
  }

  function appendPaginationLink(parent, label, page, disabled) {
    const item = document.createElement("li");
    if (disabled) {
      const span = document.createElement("span");
      span.className = "button disabled";
      span.textContent = label;
      item.appendChild(span);
      parent.appendChild(item);
      return;
    }

    const link = document.createElement("a");
    link.className = "button";
    link.href = paginationHref(page);
    link.textContent = label;
    item.appendChild(link);
    parent.appendChild(item);
  }

  function appendPaginationText(parent, label) {
    const item = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = label;
    item.appendChild(span);
    parent.appendChild(item);
  }

  function paginationHref(page) {
    const params = new URLSearchParams(window.location.search);
    params.set("page", String(Math.max(1, page)));
    return window.location.pathname + "?" + params.toString();
  }

  function uniqueServices(services) {
    const seen = {};
    return services.filter(function (service) {
      if (!service || !service.id || seen[service.id]) {
        return false;
      }
      seen[service.id] = true;
      return true;
    });
  }

  function unique(values) {
    const seen = {};
    return values.filter(function (value) {
      if (!value || seen[value]) {
        return false;
      }
      seen[value] = true;
      return true;
    });
  }

  function formatServiceDate(service) {
    const start = service && service.startAt ? Date.parse(service.startAt) : Number.NaN;
    if (Number.isFinite(start)) {
      return new Intl.DateTimeFormat("en-CA", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: service.timeZone || CHURCH_TIME_ZONE,
      }).format(new Date(start));
    }

    return text(service && service.serviceDate);
  }

  function formatServiceTime(value) {
    const normalized = text(value);
    const match = normalized.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (!match) {
      return normalized || "-";
    }

    const hour = Number(match[1]);
    const minute = match[2];
    const suffix = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return displayHour + ":" + minute + " " + suffix;
  }

  function formatAnnouncementEvent(announcement) {
    if (!announcement || !announcement.eventDateEnabled) {
      return "";
    }

    const start = text(announcement.eventStart);
    const end = text(announcement.eventEnd);
    if (start && end && start !== end) {
      return "Event: " + start + " - " + end;
    }

    return start ? "Event: " + start : "";
  }

  function currentChurchDate() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: CHURCH_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const values = {};
    parts.forEach(function (part) {
      values[part.type] = part.value;
    });
    return values.year + "-" + values.month + "-" + values.day;
  }

  function currentPageNumber() {
    const value = Number(new URLSearchParams(window.location.search).get("page"));
    return Number.isInteger(value) && value > 0 ? value : 1;
  }

  function serviceKindLabel(kind) {
    if (kind === "chinese") {
      return "Chinese Service 中文崇拜";
    }
    if (kind === "english") {
      return "English Service 英文崇拜";
    }
    if (kind === "combined") {
      return "Combined Service 聯合崇拜";
    }
    if (kind === "special") {
      return "Special Service 特別聚會";
    }
    return "";
  }

  function servicePersonnelValue(service, label) {
    const rows = array(service && service.notes && service.notes.servicePersonnel);
    const match = rows.find(function (row) {
      return text(row.label) === label;
    });
    return match ? text(match.value) : "";
  }

  function isCombinedOrSpecial(service) {
    const title = text(service && service.title);
    return service && (
      service.serviceKind === "combined" ||
      service.serviceKind === "special" ||
      /combined|聯合|联合/i.test(title)
    );
  }

  function hasAnyElement(ids) {
    return ids.some(function (id) {
      return Boolean(byId(id));
    });
  }

  function hasText(value) {
    return text(value).length > 0;
  }

  function text(value) {
    return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
  }

  function array(value) {
    return Array.isArray(value) ? value : [];
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function clear(element) {
    if (!element) {
      return;
    }

    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }

  function setText(element, value) {
    if (element) {
      element.textContent = value;
    }
  }
})();
