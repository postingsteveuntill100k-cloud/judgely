# Judgely Judging Engine & Normalization Methodology

## 1. Executive Summary

Hackathon judging faces two fundamental challenges:
1. **Judge Baseline & Variance Discrepancies**: Different judges possess distinct evaluation scales. A harsh judge might grade superior work at 3.0 out of 5.0, while a lenient judge scores mediocre work at 4.5 out of 5.0. When assignments are non-overlapping or sparse, raw averages systematically reward projects lucky enough to be assigned to lenient judges.
2. **Review Count Asymmetry & Missing Reviews**: Real-world hackathons contain unfinished judge batches, leaving some projects with 5 reviews and others with only 1 or 2 reviews. A simple average across 1 review has high variance and cannot be compared directly to an average across 4 reviews.

Judgely resolves both challenges through a **provably fair, deterministic, and explainable normalization pipeline**:
$$\text{Raw Scores} \longrightarrow \text{Judge Empirical Distribution} \longrightarrow \text{Variance-Regularized Z-Score} \longrightarrow \text{Global Scaling} \longrightarrow \text{Bayesian Shrinkage} \longrightarrow \text{Defensible Ranking}$$

---

## 2. Weighted Rubric Scoring Formula

Each project review $r$ evaluates $M$ criteria defined by the organizer.

### Mathematical Formulation
Given criterion score $s_{r,c} \in [0, S_{\max}]$ and organizer-defined weight $w_c > 0$:

$$Score_{raw}(r) = \frac{\sum_{c=1}^{M} w_c \cdot s_{r,c}}{\sum_{c=1}^{M} w_c}$$

### Rubric Criteria (Seeded from DOGFOOD Fixtures)
| Criterion | Description | Default Weight | Max Score |
| :--- | :--- | :---: | :---: |
| **Functionality** | Working prototype, feature completeness, and technical execution | 40% (0.40) | 5.0 |
| **Quality & Craft** | Code polish, architectural cleanliness, UX, and attention to detail | 35% (0.35) | 5.0 |
| **Innovation** | Novel concept, creative engineering, and distinct approach | 25% (0.25) | 5.0 |

### Edge-Case Handling:
- **Missing Criterion Score**: If a reviewer does not provide a score for an optional criterion, the weight denominator adjusts to the sum of evaluated criteria only ($\sum_{c \in \text{evaluated}} w_c$).
- **Bound Clamping**: Client and server strictly clamp $s_{r,c} = \max(0, \min(S_{\max}, s_{r,c}))$ to prevent out-of-bounds or negative scoring.
- **Duplicate Review Submissions**: The review table enforces `UNIQUE(project_id, judge_id)`. Submitting an updated review replaces the criterion scores atomically in a database transaction and updates the audit log.

---

## 3. Cross-Judge Normalization Methodology (Proof & Implementation)

### Step 1: Compute Per-Judge Empirical Parameters
For each judge $j \in J$ with review set $R_j = \{ s_{j,1}, s_{j,2}, \dots, s_{j,m_j} \}$:

$$\mu_j = \frac{1}{m_j} \sum_{k=1}^{m_j} s_{j,k}$$

$$\sigma_j = \sqrt{ \frac{1}{\max(1, m_j - 1)} \sum_{k=1}^{m_j} (s_{j,k} - \mu_j)^2 }$$

### Step 2: Compute Global Reference Parameters
Across all submitted reviews $R = \bigcup_{j} R_j$ with total count $N = |R|$:

$$\mu_{global} = \frac{1}{N} \sum_{s \in R} s$$

$$\sigma_{global} = \sqrt{ \frac{1}{N - 1} \sum_{s \in R} (s - \mu_{global})^2 }$$

### Step 3: Variance Regularization (The Zero-Variance Proof)
> **Problem Statement in Fixtures**:
> In the DOGFOOD `fixtures.json`, judge `jdg_07` awarded an identical score of $4.0$ to all 3 evaluated projects. Consequently:
> $$\sigma_{jdg\_07} = 0$$
> Standard Z-score formulas $z = \frac{s - \mu}{\sigma}$ divide by zero, resulting in undefined or infinite values.

> **Judgely Proof & Solution**:
> We define a regularized standard deviation $\sigma_j^*$:
> $$\sigma_j^* = \max(\sigma_j, \sigma_{\min})$$
> where $\sigma_{\min} = 0.35$.
> 
> *Proof of Stability*:
> For any score $s_{j,k}$:
> 1. If judge $j$ evaluated projects with variance $\sigma_j \ge 0.35$, $\sigma_j^* = \sigma_j$ (standard Z-score is preserved).
> 2. If judge $j$ has zero variance ($s_{j,k} = \mu_j$ for all $k$), the numerator is $s_{j,k} - \mu_j = 0$, giving $z_{j,k} = \frac{0}{0.35} = 0$.
> 3. Projected onto the global scale, score $s'_{j,k} = \mu_{global} + 0 \cdot \sigma_{global} = \mu_{global}$.
> 
> A judge who provides no discrimination across projects does not distort the rankings; their evaluations map neutrally to the global average without blowing up the variance.

### Step 4: Projection to Global Reference Scale
The normalized score $s'_{i,j}$ assigned by judge $j$ to project $i$ is mapped back to the 0–5 reference range:

$$z_{i,j} = \frac{s_{i,j} - \mu_j}{\sigma_j^*}$$

$$s'_{i,j} = \text{clamp}\left( \mu_{global} + z_{i,j} \cdot \sigma_{global}, \ 0, \ 5 \right)$$

### Step 5: Bayesian Prior Shrinkage for Uneven Sample Sizes
To resolve the asymmetry between projects with 1 review versus projects with 3+ reviews, Judgely applies empirical Bayes shrinkage with prior weight $K = 1.0$:

$$Score_{final}(i) = \frac{K \cdot \mu_{global} + |J_i| \cdot \bar{s}'_i}{K + |J_i|}$$

where $\bar{s}'_i = \frac{1}{|J_i|} \sum_{j \in J_i} s'_{i,j}$.

- When $|J_i| \gg K$, the project's empirical normalized evaluations dominate.
- When $|J_i| = 1$, the estimate shrinks prudently toward the global prior $\mu_{global}$, preventing single-review outliers from unfairly winning first place.

---

## 4. Rank Determination & Tie-Breaking

1. **Primary Rank**: Sorted by $Score_{final}(i)$ in descending order.
2. **First Tie-Breaker**: Highest score on the most heavily weighted rubric criterion (**Functionality**).
3. **Second Tie-Breaker**: Lower inter-judge variance (projects with strong consensus across reviewers rank ahead of polarized projects).
4. **Third Tie-Breaker**: Earliest submission timestamp (`submitted_at`).

---

## 5. Judging Health & Anomaly Signals

Judgely incorporates deterministic heuristic detection without accusatory language:
- **Zero Variance**: Detects judges with $\sigma_j < 0.001$ over $>1$ review. *Action*: Flagged for organizer review; variance regularization applied automatically.
- **Polarized Score Spread**: Detects projects with inter-judge score standard deviation $\ge 1.4$. *Action*: Flagged for optional tiebreaker judge assignment.
- **Multiple Team Submissions**: Detects teams submitting multiple projects (e.g. `tm_07` submitting `prj_07` and `prj_41`). *Action*: Flagged for organizer verification.
- **Workload Imbalance**: Highlights judges with completion rates $< 50\%$ or disproportionately large queues.
