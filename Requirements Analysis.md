# **Requirements Analysis**

# **1\. Introduction**

## **1.1 Purpose**

The X-Group Feedback Management System (XFMS) aims to digitize and centralize guest feedback collection across all X-Group restaurants and hospitality businesses. The system will replace paper-based feedback forms with a modern QR-based digital solution, enabling management to monitor customer satisfaction through dashboards, analytics, and reports.

Although Version 1.0 focuses on customer feedback management, the system architecture will support future expansion into additional hospitality management modules.

# **2\. Project Scope**

## **Included in Version 1.0**

✔ Authentication  
✔ User Management  
✔ Role & Permission Management  
✔ Branch Management  
✔ Guest Feedback  
✔ Dashboard  
✔ Analytics  
✔ Reports  
✔ System Settings

## **Future Scope**

○ Daily Branch Manager Report  
○ Daily Discount Report  
○ Daily Conveyance Bill Report  
○ Monthly Cutlery Inventory

# **3\. Functional Requirements**

## **3.1 Authentication**

The system shall allow:  
Secure login

* Role-based access  
* Access token and Refresh token. 

## 

## **3.2 User Management**

Administrators shall be able to:

* Create users  
* Update users  
* Deactivate users  
* Assign branches  
* Assign roles  
* Search users  
* Reset passwords (password update)

## **3.3 Branch Management**

Administrators shall be able to:

* Create branches  
* Update branch information  
* Activate or deactivate branches  
* Assign branch managers  
* View branch statistics

## **3.4 Guest Feedback**

Guests shall be able to:

* Scan a QR code  
* Open the feedback form  
* Automatically detect the nearest branch (optional)  
* Select a branch manually  
* Rate service quality  
* Rate food quality  
* Rate cleanliness  
* Rate staff behavior  
* Rate atmosphere  
* Add comments  
* Submit feedback  
* View a Thank You page

## 

## **3.5 Dashboard**

The dashboard shall display:

* Total feedback  
* Average ratings  
* Branch performance  
* Rating distribution  
* Recent feedback  
* Monthly trends  
* Branch ranking  
* Low-rating alerts

## **3.6 Analytics**

The system shall provide:

* Rating trends  
* Customer satisfaction trends  
* Category performance  
* KPI summary

## **3.7 Reports**

The system shall generate:

* Daily reports  
* Weekly reports  
* Monthly reports  
* Branch reports  
* Customer satisfaction reports

Export formats:

* PDF  
* Excel

# **4\. Non-Functional Requirements**

## **Performance**

* Dashboard should load within 3 seconds.  
* Feedback submission should complete within 2 seconds.  
* API responses should generally remain under 500 ms.

## **Security**

* Secure authentication  
* Role-based access control  
* Password encryption  
* HTTPS  
* Input validation  
* Protection against common web vulnerabilities

## **Scalability**

The system should support:

* Multiple brands  
* Multiple branches  
* 500+ feedback submissions per day  
* Future hospitality modules

## **Maintainability**

The application should:

* Follow a modular architecture  
* Use clean coding standards  
* Be well documented  
* Support future expansion

## **Compatibility**

Supported browsers:

* Chrome  
* Edge  
* Firefox  
* Safari

# **5\. User Roles**

| Role | Responsibilities |
| ----- | ----- |
| Guest | Submit feedback |
| Branch Manager | Monitor branch feedback and reports |
| Admin | Manage branches, users, feedback and reports |
| Super Admin | Full system administration |

---

# **6\. Business Rules**

* Every feedback belongs to one branch.  
* Guests do not need an account to submit feedback.  
* Branch Managers can access only their assigned branches.(Managers can only view and generate reports) No edit, create, or delete access.  
* Super Admin has unrestricted access.  
* Deleted records should be soft deleted.  
* Important administrative actions should be recorded in audit logs.

# 

# 

# 

# 

# 

# 

# 

# **7\. Key User Flows**

## **Guest Feedback Flow**

Scan QR  
      	*↓*  
Open Feedback Form  
*↓*  
Select Branch (Auto/Manual)  
	*↓*  
Provide (Name, email/phone, ratings etc)  
   	*↓*  
Add Comments (Optional)  
     	*↓*  
Submit Feedback  
     	*↓*  
Thank You Page

## **Admin Dashboard Flow**

Login  
  *↓*  
Dashboard  
   │  
   ├── Feedback  
   ├── Analytics  
   ├── Reports  
   ├── Branch Management  
   └── User Management

# **8\. Assumptions**

* All branches have a single QR code  
* Guests have internet access.  
* Management will regularly review reports.  
* Administrators maintain branch information.

**9\. Constraints**

* Version 1.0 focuses only on customer feedback management.  
* Future operational modules are not included in the initial release.  
* The architecture must support future expansion without major redesign.

