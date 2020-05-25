import { Component, OnInit  } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from 'src/environments/environment';
import { LocalStorageService } from '../local-storage.service';
import { LoginService } from '../login.service';
import { ActivatedRoute } from '@angular/router';

@Component({  
  selector: 'app-files',
  templateUrl: './files.component.html',
  styleUrls: ['./files.component.css']
})  
export class FilesComponent implements OnInit {

  fileData: File = null;
  previewUrl:any = null;
  fileUploadProgress: string = null;
  uploadedFilePath: string = null;


  constructor(
    private http: HttpClient,
    private localStorageService: LocalStorageService,
    private loginServie: LoginService,
    private route: ActivatedRoute) { }
   
  fileProgress(fileInput: any) {
        this.fileData = fileInput.target.files[0];

        if (this.fileData) {
          this.showSubmitButton = true
        }
        this.preview();
  }

  foreign_key;
  isPublic: string;

  ngOnInit() {
    if (!this.localStorageService.loggedInUserId) {
      this.loginServie.onAuthError()
    }

      this.route.paramMap.subscribe(params => {
        this.foreign_key = params.get('foreignKey');
        this.isPublic = params.get('isPublic');
      });
  }
   
  preview() {
      // Show preview 
      var mimeType = this.fileData.type;
      if (mimeType.match(/image\/*/) == null) {
        return;
      }
   
      var reader = new FileReader();      
      reader.readAsDataURL(this.fileData); 
      reader.onload = (_event) => { 
        this.previewUrl = reader.result; 
      }
  }

  showSubmitButton = false;
   
  onSubmit() {
    this.showSubmitButton = false;
      const formData = new FormData();
        formData.append('image', this.fileData, "image");
        formData.append('extension', this.fileData.name.split('.').pop())
        formData.append('filename', this.fileData.name)
        formData.append('userId', this.localStorageService.loggedInUserId())
        formData.append('foreignId', this.foreign_key)
        formData.append('isPublic', this.isPublic)

        const token = this.localStorageService.locallyStoredToken()

        let headers = new HttpHeaders({"bearer": token});
        headers.set('bearer', token)
        headers.set('Content-Type', 'multipart/formData')

        this.http.post(environment.api_endpoint + '/api/files/save', formData, { headers })
          .subscribe(res => {
            alert("File uploaded successfully! Now you can go back or upload more files for this item.");
            this.fileData = null;
            this.previewUrl = null;
            this.uploadedFilePath = null;
          }, msg => {
            alert(JSON.stringify(msg['error']['message']));
            if (this.fileData) {
              this.showSubmitButton = true;
            }
          })
  }
}