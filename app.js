const API =
    "https://inet.chenyurong0806.workers.dev/list";



async function upload() {


    let file =
        document
            .getElementById("file")
            .files[0];


    let data =
        new FormData();


    data.append(
        "file",
        file
    );



    fetch(
        API + "/upload",
        {
            method: "POST",
            body: data,
            credentials: "include"
        }
    )

    fetch(
        API + "/list",
        {
            credentials: "include"
        }
    )
    
    alert(
        "上传成功"
    );


}
