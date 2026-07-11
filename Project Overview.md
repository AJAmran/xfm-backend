## **X-Group Feedback Management System (XFMS) v1.0**

## **1\. Executive Summary**

The X-Group Feedback Management System (XFMS) is a dedicated, multi-tenant-ready internal platform designed to digitize, centralize, and automate operational workflows across all X-Group restaurant brands and hospitality branches.

Version 1.0 focuses exclusively on replacing outdated, paper-based guest feedback workflows with a high-performance, mobile-first **QR-Based Customer Feedback Management System**. The system captures real-time guest sentiment at the point of service and immediately surfaces actionable analytics to corporate administrators and local branch managers.

## **2\. Business Vision & Objectives**

### **Problem Statement**

Paper feedback forms suffer from low guest participation, high transcription error rates, delayed reporting, and a complete lack of cross-branch performance benchmarking. Management cannot identify operational failures or service bottlenecks dynamically.

### **Vision**

To establish a unified, data-driven hospitality management platform that safeguards service standards, drives customer retention, and scales fluidly alongside X-Group’s expanding portfolio.

### **Key Business Metrics (KPIs)**

* **Eliminate Paper Waste:** Transition 100% of feedback collection to digital channels within 30 days of deployment.  
* **Accelerate Response Times:** Surface negative feedback alerts to Branch Managers in real time (under 500ms from submission).  
* **Data-Driven Oversight:** Provide the executive team with cross-branch performance rankings, trend lines, and category-specific service ratings updated instantly.

### **Out of Scope (Planned Future Modules)**

The system architecture must anticipate and accommodate the ingestion of these operational modules in subsequent versions without requiring database migrations or core structural rewrites:

* **Daily Branch Manager Report:** End-of-day operational summaries, cash reconciliations, and incident logs.  
* **Daily Discount Report:** Automated tracking of complimentary items, operational voids, and promotional campaigns.  
* **Daily Conveyance Bill Report:** Decentralized transport expense submissions and managerial approvals.  
* **Monthly Cutlery Inventory:** Stock monitoring, breakage tracking, and automated reorder alerts for tableware.

## **4\. User Roles & Access Matrix**

The system enforces a strict hierarchical access structure via Role-Based Access Control (RBAC).

| Role | Access Scope | Functional Responsibilities |
| :---- | :---- | :---- |
| **Super Admin** | Global / Unrestricted | Complete system configuration, database management, user provisioning, and full access across all corporate restaurant brands. |
| **Admin** | Corporate Headquarters | Full access to user management, branch setup, global dashboards, comprehensive cross-branch analytics, and reporting tools. |
| **Branch Manager** | Assigned Branch Only | Siloed access to feedback feeds, daily/weekly analytics, and localized reports matching *only* their designated branch ID. |
| **Guest** | Public / Unauthenticated | Anonymous or low-friction access to scan QR codes, pick locations, and submit multi-metric evaluation forms. |

## 

## 

## **5\. Architectural Foundational Principles**

To ensure a single full-stack developer can successfully build, deploy, and maintain this system alone, the architecture relies on three rigid principles:

1. **Strict Client-Server Separation:** The Next.js frontend handles only the presentational layer and local client state. All business logic, permission rules, and data formatting reside entirely within the Express.js API layer.  
2. **Stateless Scalability:** Authentication relies strictly on cryptographically signed JWTs. The API does not persist session states in memory, ensuring rapid execution.  
3. **Domain-Driven Directory Isolation:** Both frontend and backend codebases are categorized by features (e.g., auth, branches, feedback) rather than abstract roles (e.g., components, services). This ensures future modules can be added as isolated, self-contained folders without breaking existing code.

