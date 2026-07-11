## **X-Group Feedback Management System (XFMS) v1.0**

# **1\. Overview**

The X-Group Feedback Management System (XFMS) exposes a RESTful API that enables communication between the frontend (Next.js) and the backend (Express.js). All data is exchanged in JSON format over HTTPS.  
The API follows REST principles and uses JWT-based authentication for protected endpoints.

# **2\. API Information**

| Item | Value |
| ----- | ----- |
| Architecture | REST API |
| Protocol | HTTPS |
| Data Format | JSON |
| Authentication | JWT Access Token \+ Refresh Token |
| API Version | v1 |
| Base URL | `/api/v1` |

# **3\. Authentication**

The system uses **JWT Authentication**.

### **Access Token**

* Short-lived  
* Sent in Authorization Header  
* Used to access protected APIs

Authorization: Bearer \<access\_token\>

### **Refresh Token**

* Long-lived  
* Stored in HTTP Only Cookie  
* Used to generate a new Access Token

# **4\. Response Format**

## **Success Response**

{  
 "success": true,  
 "message": "Operation completed successfully.",  
 "data": {}  
}

## **Error Response**

{  
 "success": false,  
 "message": "Validation failed.",  
 "errors": \[\]  
}

# **5\. Authentication APIs**

## **Login**

**POST**  
/api/v1/auth/login

### **Request**

{  
 "email": "admin@example.com",  
 "password": "password123"  
}

### **Response**

{  
 "success": true,  
 "accessToken": "JWT\_TOKEN",  
 "user": {  
   "id": 1,  
   "name": "Admin",  
   "role": "SUPER\_ADMIN"  
 }  
}

## **Refresh Token**

**POST**  
/api/v1/auth/refresh-token  
Uses Refresh Token Cookie.  
Returns

* New Access Token

## **Logout**

**POST**  
/api/v1/auth/logout  
Removes Refresh Token.

## **Current User**

**GET**  
/api/v1/auth/me  
Returns logged-in user information.

# **6\. User Management APIs**

## **Get Users**

**GET**  
/api/v1/users  
Supports

* Search  
* Pagination  
* Role Filter

## **Get User**

**GET**  
/api/v1/users/:id

## **Create User**

**POST**  
/api/v1/users

## **Update User**

**PUT**  
/api/v1/users/:id

## **Deactivate User**

**PATCH**  
/api/v1/users/:id/status

## **Delete User (Soft Delete)**

**DELETE**  
/api/v1/users/:id

# **7\. Branch APIs**

## **Get Branches**

**GET**  
/api/v1/branches  
Returns all active branches.

## **Get Branch**

**GET**  
/api/v1/branches/:id

## **Create Branch**

**POST**  
/api/v1/branches

## **Update Branch**

**PUT**  
/api/v1/branches/:id

## **Update Branch Status**

**PATCH**  
/api/v1/branches/:id/status

## **Delete Branch (Soft Delete)**

**DELETE**  
/api/v1/branches/:id

# **8\. Guest Feedback APIs**

## **Submit Feedback**

**POST**  
/api/v1/feedbacks

### **Request**

{  
 "branchId": 5,  
 "guestName": "John Doe",  
 "contactInfo": "01700000000",  
 "foodRating": 5,  
 "serviceRating": 5,  
 "environmentRating": 4,  
 "eventRating": 5,  
 "overallRating": 5,  
 "heardAbout": "SOCIAL\_MEDIA",  
 "ageGroup": "AGE\_18\_30",  
 "opinion": "Excellent service."  
}

## **Get All Feedback**

**GET**  
/api/v1/feedbacks  
Supports

* Search  
* Pagination  
* Branch Filter  
* Rating Filter  
* Date Filter

## **Get Feedback Details**

**GET**  
/api/v1/feedbacks/:id

# **9\. Dashboard APIs**

## **Dashboard Summary**

**GET**  
/api/v1/dashboard/summary  
Returns

* Total Feedback  
* Average Rating  
* Branch Ranking  
* Recent Feedback  
* Rating Distribution

## **Recent Feedback**

**GET**  
/api/v1/dashboard/recent-feedback

## **Branch Ranking**

**GET**  
/api/v1/dashboard/branch-ranking

## **Negative Feedback**

**GET**  
/api/v1/dashboard/negative-feedback

# **10\. Analytics APIs**

## **Rating Analytics**

**GET**  
/api/v1/analytics/ratings

## **Branch Performance**

**GET**  
/api/v1/analytics/branches

## **Monthly Trends**

**GET**  
/api/v1/analytics/monthly

## **Customer Satisfaction**

**GET**  
/api/v1/analytics/satisfaction

# **11\. Reports APIs**

## **Daily Report**

**GET**  
/api/v1/reports/daily

## **Weekly Report**

**GET**  
/api/v1/reports/weekly

## **Monthly Report**

**GET**  
/api/v1/reports/monthly

## **Branch Report**

**GET**  
/api/v1/reports/branch

## **Export Excel**

**GET**  
/api/v1/reports/export/excel

## **Export PDF**

**GET**  
/api/v1/reports/export/pdf

# **12\. System Settings APIs**

## **Get Settings**

**GET**  
/api/v1/settings

## **Update Settings**

**PUT**  
/api/v1/settings

# **13\. API Authorization Matrix**

| Endpoint | Super Admin | Admin | Branch Manager | Guest |
| ----- | :---: | :---: | :---: | :---: |
| Login | ✅ | ✅ | ✅ | ❌ |
| Logout | ✅ | ✅ | ✅ | ❌ |
| Users | ✅ | ✅ | ❌ | ❌ |
| Branches | ✅ | ✅ | ❌ | ❌ |
| Submit Feedback | ❌ | ❌ | ❌ | ✅ |
| View Feedback | ✅ | ✅ | ✅ (Own Branch) | ❌ |
| Dashboard | ✅ | ✅ | ✅ (Own Branch) | ❌ |
| Analytics | ✅ | ✅ | ✅ (Own Branch) | ❌ |
| Reports | ✅ | ✅ | ✅ (Own Branch) | ❌ |
| Settings | ✅ | ❌ | ❌ | ❌ |

# **14\. HTTP Status Codes**

| Code | Description |
| ----- | ----- |
| 200 | Success |
| 201 | Resource Created |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 409 | Conflict |
| 422 | Validation Error |
| 500 | Internal Server Error |

# **15\. API Security**

The API implements the following security measures:

* HTTPS-only communication  
* JWT Access Token authentication  
* HTTP-only Refresh Token cookies  
* Role-Based Access Control (RBAC)  
* Password hashing with bcrypt  
* Request validation using Zod  
* SQL Injection protection via Prisma ORM  
* Cross-Site Scripting (XSS) protection  
* CORS configuration  
* Rate limiting on authentication and public endpoints

# **16\. API Versioning**

Current Version:  
/api/v1  
Future releases will use versioned endpoints (e.g., `/api/v2`) to maintain backward compatibility without breaking existing clients.  
