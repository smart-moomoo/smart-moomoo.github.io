# Hao Ren — personal website

A responsive academic profile for `https://smart-moomoo.github.io/`. Plain HTML, CSS, and a small optional navigation script; no build step or package installation is required. Fonts and assets are local/system resources.

## Preview

From this directory:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open <http://localhost:8000>. You can also open `index.html` directly.

## Edit the first draft

- **Content:** `index.html` contains the bio, experience, interests, projects, education, and profile links.
- **Publications:** ApproxMLIR (MLSys 2026), Intelligent Triage (ICSE-SEIP 2026), and ByteFS (ASPLOS 2025) appear in your requested order with full titles, complete author lists, venues, pages, paper links, available code, and downloadable BibTeX files in `citations/`. Jianing Liu and Hao Ren are marked as co-first authors on Intelligent Triage, as confirmed by you. Metadata was verified against the MLSys proceedings, the ICSE conference program, publisher-deposited Crossref records, and the ByteFS paper.
- **Education:** UIUC M.S. ECE (Aug 2024–May 2026), compiler focus, and ECE 391 teaching are supported by your pasted LinkedIn profile and university-hosted thesis. Zhejiang University (2020–2024) comes from your profile, with Electrical Engineering / ZJUI corroborated by your prior personal website. The third education entry was collapsed in the supplied profile, so its exact diploma title is not invented.
- **Experience:** All five date ranges and industry job titles now come from the LinkedIn text you supplied: NVIDIA full-time (Jun 2026–present), UIUC master's work (Aug 2024–May 2026), NVIDIA internship (May–Aug 2025), Microsoft internship (Oct 2023–Aug 2024), and UIUC undergraduate research (Nov 2022–Aug 2023). The informal academic role labels are rendered as master's research and undergraduate research. Mentor names are corroborated by your thesis. ByteFS is listed as ASPLOS 2025 according to the published proceedings, correcting the ASPLOS24 shorthand in LinkedIn.
- **Interests:** AI, SW + HW (compiler, system), as supplied by you.
- **Contributions:** IREE participation is based on your description. LLVM and IREE link directly to their repositories; PR-author searches are not used because commits may be submitted by coauthors. Counts are omitted.
- **Design:** `styles.css` controls colors, typography, layout, mobile, and print styles.

## Publish with GitHub Pages

1. Create a public repository named **smart-moomoo.github.io** in the **smart-moomoo** account.
2. Commit these site files at the root of its `main` branch and push them.
3. In **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, then **main** and **/(root)**, and save.
4. GitHub Pages will publish the site at <https://smart-moomoo.github.io/>.

The `.nojekyll` file lets Pages serve the site directly. This draft has not been pushed or published. See [GitHub’s Pages setup documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).

## Content sources

- LinkedIn profile text supplied directly in the conversation — authoritative role titles, dates, and degree dates; supersedes the incomplete public preview and earlier reconstruction.

- [UIUC master's thesis](https://misailo.cs.illinois.edu/papers/hao-ren-thesis.pdf) — M.S. ECE, 2026, advisor, NVIDIA internship and mentor, four teaching semesters, undergraduate research with Jian Huang.
- [Sasa Misailovic's alumni listing](https://misailo.cs.illinois.edu/) — graduate research supervision in Spring 2025–Spring 2026, next position as software engineer at NVIDIA.
- [Author's 2024 retrospective](https://moomoohorse.github.io/blog/reflection-2024) — entered UIUC M.S. ECE in 2024; ten-month Microsoft internship completed in 2024.
- [Author's Microsoft internship write-up](https://moomoohorse.github.io/blog/microsoft-research-part-1) — Research Software Development Engineer Intern, Microsoft STCA.
- [Author's 2023 retrospective](https://moomoohorse.github.io/blog/reflection-2023) — joined Microsoft and PlatformX in 2023.
- [Author's previous homepage](https://moomoohorse.github.io/) — ZJU–UIUC Electrical Engineering background.
- [ECE 391 Fall 2024 staff](https://courses.grainger.illinois.edu/ece391/fa2024/overview.html) — graduate teaching assistant role.
- [ZJUI senior design course](https://courses.grainger.illinois.edu/ece445zjui/project.asp?id=11961) — undergraduate program corroboration.
- [ApproxMLIR — MLSys proceedings](https://proceedings.mlsys.org/paper_files/paper/2026/hash/bbd3e0e9913824bbc46e7e87b11461ae-Abstract-Conference.html) and [official BibTeX](https://proceedings.mlsys.org/paper_files/paper/772-/bibtex).
- [Intelligent Triage — ICSE program](https://conf.researchr.org/details/icse-2026/icse-2026-software-engineering-in-practice/34/Intelligent-Triage-Interpretable-Incident-Triage-Workflow-using-LLM-Extracted-Triage) and [publisher metadata](https://api.crossref.org/works/10.1145%2F3786583.3786887).
- [ByteFS — author-hosted paper](https://platformxlab.github.io/papers/bytefs-asplos25.pdf) and [publisher metadata](https://api.crossref.org/works/10.1145%2F3669940.3707250).
- [ApproxMLIR code](https://github.com/uiuc-arc/approxMLIR) and [ByteFS code](https://github.com/platformxlab/bytefs).
- [LinkedIn](https://www.linkedin.com/in/hao-ren-b7b216244/) — name, employer, CUDA compiler middle-end, Zhejiang University dates. Location updated to Santa Clara per your feedback.
- [Work GitHub](https://github.com/nvidia-moomoo) and [public profile API](https://api.github.com/users/nvidia-moomoo) — NVVM compiler work.
- [Personal GitHub](https://github.com/smart-moomoo).

Public content checked September 18, 2026.
